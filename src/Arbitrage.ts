import * as _ from "lodash";
import { BigNumber, Contract, Wallet, ethers } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { WETH_ADDRESS } from "./addresses";
import { EthMarket } from "./EthMarket";
import { ETHER, THOUSAND_GWEI, bigNumberToDecimal } from "./utils";
import { UniswappyV3EthPair } from "./UniswappyV3EthPair"

export interface CrossedMarketDetails {
  profit: BigNumber,
  volume: BigNumber,
  tokenAddress: string,
  buyFromMarket: string,
  sellToMarket: EthMarket,
  inter: BigNumber,
  v3Tov2: boolean,
}

export type MarketsByToken = { [tokenAddress: string]: Array<UniswappyV3EthPair> }

export function getBestCrossedMarket(crossedMarkets: Array<UniswappyV3EthPair>, feeTires: Array<number>, expectedTokenOut: Array<BigNumber>, expectedWethOut: Array<BigNumber>, tokenAddr: Array<string>, v3Tov2: Array<boolean>, amountIn: BigNumber): CrossedMarketDetails | undefined {
  let bestCrossedMarket: CrossedMarketDetails | undefined = undefined;
  for (let i = 0; i < crossedMarkets.length; i++) {
    const market = crossedMarkets[i]
    const profit = expectedWethOut[i].sub(amountIn)
    if (bestCrossedMarket !== undefined && profit.gt(bestCrossedMarket.profit)) {
      bestCrossedMarket = {
        volume: amountIn,
        profit: profit,
        tokenAddress: tokenAddr[i],
        buyFromMarket: market.v3Pools[feeTires[i]],
        sellToMarket: market,
        inter: expectedTokenOut[i],
        v3Tov2: v3Tov2[i],
      }
    }
    bestCrossedMarket = {
      volume: amountIn, // how much to buy
      profit: profit, // how much profit
      tokenAddress: tokenAddr[i],
      buyFromMarket: market.v3Pools[feeTires[i]],
      sellToMarket: market,
      inter: expectedTokenOut[i],
      v3Tov2: v3Tov2[i],
    }
  }
  return bestCrossedMarket;
}

export class Arbitrage {
  private flashbotsProvider: FlashbotsBundleProvider;
  private bundleExecutorContract: Contract;
  private executorWallet: Wallet;

  constructor(executorWallet: Wallet, flashbotsProvider: FlashbotsBundleProvider, bundleExecutorContract: Contract, quoterContract: Contract) {
    this.executorWallet = executorWallet;
    this.flashbotsProvider = flashbotsProvider;
    this.bundleExecutorContract = bundleExecutorContract;
  }

  static printCrossedMarket(crossedMarket: CrossedMarketDetails): void {
    const buyTokens = crossedMarket.buyFromMarket
    const sellTokens = crossedMarket.sellToMarket.tokens
    console.log(
      `Profit: ${bigNumberToDecimal(crossedMarket.profit)} Volume: ${bigNumberToDecimal(crossedMarket.volume)}\n` +
      // market to sell WETH
      `Sell Weth to V3 (${crossedMarket.buyFromMarket})\n` +
      // market to buy back WETH
      `For more Weth from V2 (${crossedMarket.sellToMarket.marketAddress})\n` +
      `  ${sellTokens[0]} => ${sellTokens[1]}\n` +
      `\n`
    )
  }

  async evaluateMarkets(marketsByToken: MarketsByToken, amountIn: BigNumber): Promise<Array<CrossedMarketDetails>> {
    const bestCrossedMarkets = new Array<CrossedMarketDetails>()

    const z: BigNumber = BigNumber.from(0)
    for (const tokenAddress in marketsByToken) {

      const markets = marketsByToken[tokenAddress]
      const pricedMarkets = _.map(markets, (ethMarket: UniswappyV3EthPair) => {
        
        const feeTires: Array<number> = []

        for (let i = 0; i < ethMarket.v3FeesOn.length; i++) {
          if (ethMarket.expectedTokenOut[i].gt(z)) {
            feeTires.push(i)
          }
        }

        return {
          ethMarket: ethMarket,
          feeTires: feeTires,
        }
      });

      const crossedMarkets = new Array<UniswappyV3EthPair>()
      const toTakeFeeTire = new Array<number>()
      const expectedWethOut = new Array<BigNumber>()
      const expectedTokenOut = new Array<BigNumber>()
      const tokenAddr = new Array<string>()
      const v3Tov2 = new Array<boolean>()
      // for (const pricedMarket of pricedMarkets) {
      _.forEach(pricedMarkets, pm => {
        for (const feeTire of pm.feeTires) {
          const amountOut = pm.ethMarket.getTokensOut(pm.ethMarket.tokenAddress, WETH_ADDRESS, pm.ethMarket.expectedTokenOut[feeTire])
          if (amountOut.gt(amountIn)) {
            crossedMarkets.push(pm.ethMarket)
            toTakeFeeTire.push(feeTire)
            expectedTokenOut.push(pm.ethMarket.expectedTokenOut[feeTire])
            expectedWethOut.push(amountOut)
            tokenAddr.push(tokenAddress)
            v3Tov2.push(true)
          }
        }
      })

      const bestCrossedMarket = getBestCrossedMarket(crossedMarkets, toTakeFeeTire, expectedTokenOut, expectedWethOut, tokenAddr, v3Tov2, amountIn);
      if (bestCrossedMarket !== undefined && bestCrossedMarket.profit.gt(ETHER.div(1000))) { // 100000 // 1000
        bestCrossedMarkets.push(bestCrossedMarket)
      }
    }
    bestCrossedMarkets.sort((a, b) => a.profit.lt(b.profit) ? 1 : a.profit.gt(b.profit) ? -1 : 0)

    return bestCrossedMarkets
  }

  // TODO: take more than 1
  async takeCrossedMarkets(bestCrossedMarkets: CrossedMarketDetails[], blockNumber: number, minerRewardPercentage: number, amountIn: BigNumber): Promise<void> {
    for (const bestCrossedMarket of bestCrossedMarkets) {

      // console.log("Send this much WETH", bestCrossedMarket.volume.toString(), "get this much profit", bestCrossedMarket.profit.toString())

      const targets: Array<string> = []
      const payloads: Array<string> = []

      if (bestCrossedMarket.v3Tov2) {

        const tokenA = BigNumber.from(bestCrossedMarket.tokenAddress)
        const tokenB = BigNumber.from(WETH_ADDRESS)
        var buyCalls: ethers.PopulatedTransaction = {}

        // by v3 pool def, token0 addr < token1 addr
        if (tokenA.lt(tokenB)) { // WETH is token 1
          buyCalls = await this.bundleExecutorContract.populateTransaction.uniswapWethV3_OneForZero(bestCrossedMarket.buyFromMarket, bestCrossedMarket.sellToMarket.marketAddress, amountIn, WETH_ADDRESS)
        } else { // WETH is token 0
          buyCalls = await this.bundleExecutorContract.populateTransaction.uniswapWethV3_ZeroForOne(bestCrossedMarket.buyFromMarket, bestCrossedMarket.sellToMarket.marketAddress, amountIn, WETH_ADDRESS)
        }
        if (buyCalls === undefined || buyCalls.data === undefined) throw new Error("undefined buyCalls, what are you trying to buy?")

        const sellCallData = await bestCrossedMarket.sellToMarket.sellTokens(
          bestCrossedMarket.tokenAddress,  // bestCrossedMarket.tokenAddress, 
          bestCrossedMarket.inter, 
          this.bundleExecutorContract.address
        );
  
        targets.push(...[this.bundleExecutorContract.address, bestCrossedMarket.sellToMarket.marketAddress])
        payloads.push(...[buyCalls.data, sellCallData])
      } else {
        console.log("v2 to v3 not implemented yet")
      }

      const minerReward = bestCrossedMarket.profit.mul(minerRewardPercentage).div(100);
      const transaction = await this.bundleExecutorContract.populateTransaction.uniswapWethV3(minerReward, targets, payloads, {
        gasPrice: BigNumber.from(0),
        gasLimit: BigNumber.from(1000000),
      });

      try {
        const estimateGas = await this.bundleExecutorContract.provider.estimateGas(
          {
            ...transaction,
            from: this.executorWallet.address
          })
        if (estimateGas.gt(1400000)) {
          console.log("EstimateGas succeeded, but suspiciously large: " + estimateGas.toString())
          continue
        }
        transaction.gasLimit = estimateGas.mul(2)
      } catch (e) {
        console.warn(e)
        console.warn(`Estimate gas failure for ${JSON.stringify(bestCrossedMarket)}`)
        continue
      }

      const gasPrice = await this.bundleExecutorContract.provider.getGasPrice()
      transaction.gasPrice = gasPrice; // gasPrice.mul(1);
      // transaction.maxFeePerGas = gasPrice.mul(7).div(5);
      transaction.chainId = Number(process.env.CHAIN_ID)

      const cost = transaction.gasPrice.mul(transaction.gasLimit.div(2))
      const myProfit = bestCrossedMarket.profit.sub(minerReward)
      if (cost.gt(myProfit)) {
        console.log(`token ${bestCrossedMarket.tokenAddress}: tx gas cost ${cost.div(THOUSAND_GWEI).toString()} > profit ${myProfit.div(THOUSAND_GWEI).toString()}`)
        continue
      }

      const bundledTransactions = [
        {
          signer: this.executorWallet,
          transaction: transaction
        }
      ];
      const signedBundle = await this.flashbotsProvider.signBundle(bundledTransactions)
      console.log("bundle signed")

      const simulation = await this.flashbotsProvider.simulate(signedBundle, blockNumber + 1)
      console.log("bundle simulation")

      if ("error" in simulation || simulation.firstRevert !== undefined) {
        if ("error" in simulation) {
          console.log(`Simulation Error Message: ${simulation.error.message}`);
        }
        console.log(`Simulation Error on token ${bestCrossedMarket.tokenAddress}, skipping`)
        continue
      } else {
        console.log(
          `Simulation Success: ${blockNumber} ${JSON.stringify(
            simulation,
            null,
            2
          )}`
        );
      }

      console.log(`Submitting bundle, profit sent to miner: ${bigNumberToDecimal(simulation.coinbaseDiff)}, effective gas price: ${bigNumberToDecimal(simulation.coinbaseDiff.div(simulation.totalGasUsed), 9)} GWEI`)
      const bundlePromises =  _.map([blockNumber + 1, blockNumber + 2], targetBlockNumber =>
        this.flashbotsProvider.sendRawBundle(
          signedBundle,
          targetBlockNumber
        ))
      await Promise.all(bundlePromises)
      console.log(`Bundle succesfully submitted with expected profit approximately ${bestCrossedMarket.profit.div(1000000000).toString()} GWEI`)
      return
    }
    console.log("No arbitrage submitted to relay")
  }
}
