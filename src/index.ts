import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { Contract, providers, Wallet, BigNumber } from "ethers";
import { UniswappyV3EthPair } from "./UniswappyV3EthPair";
import { FACTORY_ADDRESSES, UNISWAP_V3_FACTORY_ADDRESS } from "./addresses";
import { Arbitrage } from "./Arbitrage";
import { get } from "https"
import { BUNDLE_EXECUTOR_ABI, QUOTER_ABI } from './abi'
import { ETHER } from "./utils";

// if have time todo
// feeOn=false for expectedOut=0 after UpdateReserve
// remove v3 pool with low liquidity

// TODO
// v3 indirect pairs x/y -> y/z -> z/x
// add v2->v3 case, weth -> v2 -> dai -> v3 -> weth
// keep a moving window average of success amountIn?
// deploy contract with hardhat, add withdraw all call

async function main() {
  const ETH_RPC_URL = process.env.ETH_RPC_URL || "http://127.0.0.1:8545"
  const PRIVATE_KEY = process.env.PRIVATE_KEY || ""
  const executor_addr = process.env.EXECUTOR_ADDR || ""
  const quoter_addr = process.env.QOUTER_ADDR || ""
  
  const FLASHBOTS_RELAY_SIGNING_KEY = process.env.FLASHBOTS_RELAY_SIGNING_KEY  || ""; // || getDefaultRelaySigningKey();
  
  const MINER_REWARD_PERCENTAGE = parseInt(process.env.MINER_REWARD_PERCENTAGE || "80")
  
  const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL || ""
  
  const provider = new providers.StaticJsonRpcProvider(ETH_RPC_URL);
  
  const arbitrageSigningWallet = new Wallet(PRIVATE_KEY);
  const flashbotsRelaySigningWallet = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY);

  if (PRIVATE_KEY === "") {
    console.warn("Must provide PRIVATE_KEY environment variable")
    process.exit(1)
  }
  if (executor_addr === "") {
    console.warn("Must provide executor_addr variable. Please see README.md")
    process.exit(1)
  }
  
  if (FLASHBOTS_RELAY_SIGNING_KEY === "") {
    console.warn("Must provide FLASHBOTS_RELAY_SIGNING_KEY. Please see https://github.com/flashbots/pm/blob/main/guides/searcher-onboarding.md")
    process.exit(1)
  }

  function healthcheck() {
    if (HEALTHCHECK_URL === "") {
      return
    }
    get(HEALTHCHECK_URL).on('error', console.error);
  }

  console.log("MINER_REWARD_PERCENTAGE: ", MINER_REWARD_PERCENTAGE)
  console.log("Searcher Wallet Address: " + await arbitrageSigningWallet.getAddress())
  console.log("Flashbots Relay Signing Wallet Address: " + await flashbotsRelaySigningWallet.getAddress())

  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider, 
    flashbotsRelaySigningWallet,
    // below only needed for goerli
    // process.env.FLASHBOT_GOERLI_PROVIDER,
    // process.env.FLASHBOT_GOERLI_NAME
  );

  const arbitrage = new Arbitrage(
    arbitrageSigningWallet,
    flashbotsProvider,
    new Contract(executor_addr, BUNDLE_EXECUTOR_ABI, provider),
    new Contract(quoter_addr, QUOTER_ABI, provider)
  )

  const marketsV3 = await UniswappyV3EthPair.getUniswapMarketsByToken(provider, FACTORY_ADDRESSES, UNISWAP_V3_FACTORY_ADDRESS, ETHER);
  console.log("all markets length: ", marketsV3.allMarketPairs.length)

  provider.on('block', async (blockNumber) => {
    const amountIn = ETHER.mul(11).div(69);

    await UniswappyV3EthPair.updateReserves(provider, marketsV3.allMarketPairs, amountIn);

    // this get the most profitable pair for each token->[market1, market2, market3...] group
    const bestCrossedMarkets = await arbitrage.evaluateMarkets(marketsV3.marketsByToken, amountIn);
    if (bestCrossedMarkets.length === 0) {
      console.log("No crossed markets")
      return
    }

    // bestCrossedMarkets.forEach(Arbitrage.printCrossedMarket);
    arbitrage.takeCrossedMarkets(bestCrossedMarkets, blockNumber, MINER_REWARD_PERCENTAGE, amountIn).then(healthcheck).catch(console.error);
  })
}

main();