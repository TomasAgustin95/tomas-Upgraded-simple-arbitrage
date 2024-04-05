import * as _ from "lodash";
import { BigNumber, Contract, providers } from "ethers";
import { UNISWAP_PAIR_ABI, UNISWAP_QUERY_ABI } from "./abi";
import { UNISWAP_LOOKUP_CONTRACT_ADDRESS, WETH_ADDRESS, UNISWAP_V3_QUOTER_ADDRESS } from "./addresses";
import { CallDetails, EthMarket, MultipleCallData, TokenBalances } from "./EthMarket";
import { bigNumberToDecimal, ETHER } from "./utils";
import { MarketsByToken } from "./Arbitrage";

// batch count limit helpful for testing, loading entire set of uniswap markets takes a long time to load
const BATCH_COUNT_START: number = +(process.env.BATCH_COUNT_START || "0"); // 0
const BATCH_COUNT_LIMIT: number = +(process.env.BATCH_COUNT_LIMIT || "1"); // 100
const UNISWAP_BATCH_SIZE = 250; // 1000
const UPDATE_BATCH_SIZE = 30;


// Not necessary, slightly speeds up loading initialization when we know tokens are bad
// Estimate gas will ensure we aren't submitting bad bundles, but bad tokens waste time
const blacklistTokens = [
  '0xD13c7342e1ef687C5ad21b27c2b65D772cAb5C8c'
]

const feeTier: Array<Number> = [100, 500, 3000, 10000]

interface GroupedMarkets {
  marketsByToken: MarketsByToken;
  allMarketPairs: Array<UniswappyV3EthPair>;
}

export class UniswappyV3EthPair extends EthMarket {
  // Is this correct to use WETH address for uniswap pair abi? this is not uniswap abi contract address
  static uniswapInterface = new Contract(WETH_ADDRESS, UNISWAP_PAIR_ABI);
  private _tokenBalances: TokenBalances
  public v3Pools: Array<string>
  public v3FeesOn: Array<boolean>
  public tokenAddress: string
  public expectedTokenOut: Array<BigNumber> = []
  public expectedWethOut: Array<BigNumber> = []

  constructor(marketAddress: string, tokens: Array<string>, _tokenAddress: string, _v3Pools: Array<string>, _v3FeesOn: Array<boolean>, protocol: string) {
    super(marketAddress, tokens, protocol);
    this._tokenBalances = _.zipObject(tokens,[BigNumber.from(0), BigNumber.from(0)])
    this.v3Pools = _v3Pools
    this.v3FeesOn = _v3FeesOn
    this.tokenAddress = _tokenAddress

    for (let i = 0; i < feeTier.length; i++){
      this.expectedTokenOut.push(BigNumber.from(0))
      this.expectedWethOut.push(BigNumber.from(0))
    }
  }

  receiveDirectly(tokenAddress: string): boolean {
    return tokenAddress in this._tokenBalances
  }

  async prepareReceive(tokenAddress: string, amountIn: BigNumber): Promise<Array<CallDetails>> {
    if (this._tokenBalances[tokenAddress] === undefined) {
      throw new Error(`Market does not operate on token ${tokenAddress}`)
    }
    if (! amountIn.gt(0)) {
      throw new Error(`Invalid amount: ${amountIn.toString()}`)
    }
    // No preparation necessary
    return []
  }

  static async getUniswappyMarkets(provider: providers.JsonRpcProvider, factoryAddress: string, factoryAddresseV3: string): Promise<Array<UniswappyV3EthPair>> {
    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);

    const marketPairs = new Array<UniswappyV3EthPair>()
    for (let i = BATCH_COUNT_START * UNISWAP_BATCH_SIZE; i < BATCH_COUNT_LIMIT * UNISWAP_BATCH_SIZE; i += UNISWAP_BATCH_SIZE) {
      console.log(`UNISWAP_LOOKUP_CONTRACT_ADDRESS ${factoryAddress} <= flash query i <= ${i}`)
      const pairs: Array<Array<string>> = (await uniswapQuery.functions.getPairsByIndexRange(factoryAddress, factoryAddresseV3, feeTier, i, i + UNISWAP_BATCH_SIZE))[0];
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const marketAddress = pair[2];
        let tokenAddress: string;

        if (pair[0] === WETH_ADDRESS) {
          tokenAddress = pair[1]
        } else if (pair[1] === WETH_ADDRESS) {
          tokenAddress = pair[0]
        } else {
          continue;
        }

        if (!blacklistTokens.includes(tokenAddress)) {
          const activeAddr: Array<string> = []
          const feesOn: Array<boolean> = new Array<boolean>(feeTier.length);
          
          const s: number = pair.length - feesOn.length
          var f: boolean = false
          for (let j = 0; j < feesOn.length; j++) {
            activeAddr.push(pair[s+j])
            if (pair[s+j] === '0x0000000000000000000000000000000000000000') {
              feesOn[j] = false
            } else {
              f = true
              feesOn[j] = true
            }
          }
          
          if (f) {
            const uniswappyV2EthPair = new UniswappyV3EthPair(marketAddress, [pair[0], pair[1]], tokenAddress, activeAddr, feesOn, ""); // activeAddr is for swap not updateReserve
            marketPairs.push(uniswappyV2EthPair);
          }
        }
      }
      if (pairs.length < UNISWAP_BATCH_SIZE) {
        break
      }
    }

    return marketPairs
  }

  static async getUniswapMarketsByToken(provider: providers.JsonRpcProvider, factoryAddresses: Array<string>, factoryAddresseV3: string, amountIn: BigNumber): Promise<GroupedMarkets> {
    // this phase get market pairs which at least one is WETH from each market (uniswap, sushiswap...)
    const allPairs = await Promise.all(
      _.map(factoryAddresses, factoryAddress => UniswappyV3EthPair.getUniswappyMarkets(provider, factoryAddress, factoryAddresseV3))
    )
    console.log("allPairs.length", allPairs.length)
 
    // this group token pairs across markeys by (unique token address since the other must have been WETH after above process)
    const marketsByTokenAll = _.chain(allPairs)
      .flatten()
      .groupBy(pair => pair.tokens[0] === WETH_ADDRESS ? pair.tokens[1] : pair.tokens[0])
      .value()
    console.log("Object.keys(marketsByTokenAll).length", Object.keys(marketsByTokenAll).length)

    // this filtered out token pairs which have less than two market has, which means there are no chance to do arbitrage
    const allMarketPairs = _.chain(
      _.pickBy(marketsByTokenAll, a => a.length > 0) // weird TS bug, chain'd pickBy is Partial<>
    )
      .values()
      .flatten()
      .value()
    console.log("allMarketPairs.length", allMarketPairs.length)

    // This update each market's token balance to the latest block timestamp
    await UniswappyV3EthPair.updateReserves(provider, allMarketPairs, amountIn);

    // 1, this filtered out markets with weth balances lower than 1 eth
    // 2, and group back token pairs across different markets
    const marketsByToken = _.chain(allMarketPairs)
      .filter(pair => {
          return pair.getBalance(WETH_ADDRESS).gt(ETHER)
        }
      )
      .groupBy(pair => pair.tokens[0] === WETH_ADDRESS ? pair.tokens[1] : pair.tokens[0])
      .value()
    console.log("Object.keys(marketsByToken).length", Object.keys(marketsByToken).length)


    return {
      marketsByToken,
      allMarketPairs
    }
  }
  
  static async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  static async updateReserves(provider: providers.JsonRpcProvider, allMarketPairs: Array<UniswappyV3EthPair>, amountIn: BigNumber): Promise<void> {
    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);
    const pairAddresses = allMarketPairs.map(marketPair => marketPair.marketAddress);
    const tokenAddresses = allMarketPairs.map(marketPair => marketPair.tokenAddress);
    const feeOns = allMarketPairs.map(marketPair => marketPair.v3FeesOn);
    console.log("Updating markets, count:", pairAddresses.length)

    const reserves: Array<Array<BigNumber>> = []
    const reservesBatchesPromise: Array<Promise<any>> = []
    for (let i = 0; i*UPDATE_BATCH_SIZE < pairAddresses.length; i += 1) {
      // console.log(`updating market batch ${i}`)

      const lower = i*UPDATE_BATCH_SIZE
      const upper = (i+1)*(UPDATE_BATCH_SIZE) < pairAddresses.length ? (i+1)*(UPDATE_BATCH_SIZE) : pairAddresses.length

      // console.log(`${lower} ${upper}`)

      const pairAddressesBatch = pairAddresses.slice(lower, upper)
      const tokenAddressesBatch = tokenAddresses.slice(lower, upper)
      const feeOnsBatch = feeOns.slice(lower, upper)

      // console.log(
      //   {
      //     UNISWAP_V3_QUOTER_ADDRESS: UNISWAP_V3_QUOTER_ADDRESS, 
      //     pairAddressesBatch: pairAddressesBatch, 
      //     WETH_ADDRESS: WETH_ADDRESS,
      //     tokenAddressesBatch: tokenAddressesBatch.length, 
      //     feeTier: feeTier.length, 
      //     feeOnsBatch: [feeOnsBatch.length, feeOnsBatch[0].length], 
      //     amountIn: amountIn,
      //   }
      // )

      reservesBatchesPromise.push(
        uniswapQuery.callStatic.getReservesByPairs(
          UNISWAP_V3_QUOTER_ADDRESS, 
          pairAddressesBatch, 
          WETH_ADDRESS,
          tokenAddressesBatch, 
          feeTier, 
          feeOnsBatch, 
          amountIn
        )
      );

      // reserves = reserves.concat(reservesBatch);
      // console.log(`length of reserves: ${reserves.length}`)
      // for (const reserve of reservesBatch) {
      //   reserves.push(reserve)
      // }
    }

    const reservesBatches: Array<Array<Array<BigNumber>>> = await Promise.all(reservesBatchesPromise);
    for (const reservesBatch of reservesBatches) {
      for (const reserve of reservesBatch) {
        reserves.push(reserve)
      }
    }
    
    // console.log(
    //   "reserves",
    //   reserves.map(reserve => 
    //     reserve.map(
    //       r => r.toString()
    //     )
    //   )
    // )

    for (let i = 0; i < allMarketPairs.length; i++) {
      const marketPair = allMarketPairs[i];
      const reserve = reserves[i]
      marketPair.setReservesViaOrderedBalances([reserve[0], reserve[1]])
      for (let j = 0; j < feeTier.length; j++){
        marketPair.expectedTokenOut[j] = reserve[2+j]
      }
    }
  }

  getBalance(tokenAddress: string): BigNumber {
    const balance = this._tokenBalances[tokenAddress]
    if (balance === undefined) throw new Error("bad token")
    return balance;
  }

  setReservesViaOrderedBalances(balances: Array<BigNumber>): void {
    this.setReservesViaMatchingArray(this._tokens, balances)
  }

  setReservesViaMatchingArray(tokens: Array<string>, balances: Array<BigNumber>): void {
    const tokenBalances = _.zipObject(tokens, balances)
    if (!_.isEqual(this._tokenBalances, tokenBalances)) {
      this._tokenBalances = tokenBalances
    }
  }

  getTokensIn(tokenIn: string, tokenOut: string, amountOut: BigNumber): BigNumber {
    const reserveIn = this._tokenBalances[tokenIn]
    const reserveOut = this._tokenBalances[tokenOut]
    return this.getAmountIn(reserveIn, reserveOut, amountOut);
  }

  getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): BigNumber {
    const reserveIn = this._tokenBalances[tokenIn]
    const reserveOut = this._tokenBalances[tokenOut]
    return this.getAmountOut(reserveIn, reserveOut, amountIn);
  }

  getAmountIn(reserveIn: BigNumber, reserveOut: BigNumber, amountOut: BigNumber): BigNumber {
    const numerator: BigNumber = reserveIn.mul(amountOut).mul(1000);
    const denominator: BigNumber = reserveOut.sub(amountOut).mul(997);
    return numerator.div(denominator).add(1);
  }

  getAmountOut(reserveIn: BigNumber, reserveOut: BigNumber, amountIn: BigNumber): BigNumber {
    const amountInWithFee: BigNumber = amountIn.mul(997);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(1000).add(amountInWithFee);
    return numerator.div(denominator);
  }

  async sellTokensToNextMarket(tokenIn: string, amountIn: BigNumber, ethMarket: EthMarket): Promise<MultipleCallData> {
    if (ethMarket.receiveDirectly(tokenIn) === true) {
      const exchangeCall = await this.sellTokens(tokenIn, amountIn, ethMarket.marketAddress)
      return {
        data: [exchangeCall],
        targets: [this.marketAddress]
      }
    }

    const exchangeCall = await this.sellTokens(tokenIn, amountIn, ethMarket.marketAddress)
    return {
      data: [exchangeCall],
      targets: [this.marketAddress]
    }
  }

  async sellTokens(tokenIn: string, amountIn: BigNumber, recipient: string): Promise<string> {
    // function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
    let amount0Out = BigNumber.from(0)
    let amount1Out = BigNumber.from(0)
    let tokenOut: string;
    if (tokenIn === this.tokens[0]) {
      tokenOut = this.tokens[1]
      amount1Out = this.getTokensOut(tokenIn, tokenOut, amountIn)
    } else if (tokenIn === this.tokens[1]) {
      tokenOut = this.tokens[0]
      amount0Out = this.getTokensOut(tokenIn, tokenOut, amountIn)
    } else {
      throw new Error("Bad token input address")
    }
    const populatedTransaction = await UniswappyV3EthPair.uniswapInterface.populateTransaction.swap(amount0Out, amount1Out, recipient, []);
    if (populatedTransaction === undefined || populatedTransaction.data === undefined) throw new Error("HI")
    return populatedTransaction.data;
  }
}

function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}
