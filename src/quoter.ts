import { Contract, providers, Wallet, BigNumber, ethers } from "ethers";
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'
import { abi as QuoterABI } from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json'
import { BUNDLE_EXECUTOR_ABI_V3 } from './abi'
import * as env from './env'
import * as goerli_env from './goerli_env'

// Creating The Interfaces
interface Immutables {
    factory: string
    token0: string
    token1: string
    fee: number
    tickSpacing: number
    maxLiquidityPerTick: ethers.BigNumber
  }
  
interface State {
    liquidity: ethers.BigNumber
    sqrtPriceX96: ethers.BigNumber
    tick: number
    observationIndex: number
    observationCardinality: number
    observationCardinalityNext: number
    feeProtocol: number
    unlocked: boolean
}

// Fetching Immutable Data
async function getPoolImmutables(poolContract: Contract) {
    const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
        poolContract.factory(),
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.tickSpacing(),
        poolContract.maxLiquidityPerTick(),
    ])

    const immutables: Immutables = {
        factory,
        token0,
        token1,
        fee,
        tickSpacing,
        maxLiquidityPerTick,
    }
    return immutables
}

// Fetching State Data
async function getPoolState(poolContract: Contract) {
    const [liquidity, slot] = await Promise.all([poolContract.liquidity(), poolContract.slot0()])

    const PoolState: State = {
        liquidity,
        sqrtPriceX96: slot[0],
        tick: slot[1],
        observationIndex: slot[2],
        observationCardinality: slot[3],
        observationCardinalityNext: slot[4],
        feeProtocol: slot[5],
        unlocked: slot[6],
    }

    return PoolState
}

export async function v3Test(amountIn: BigNumber, provider: providers.StaticJsonRpcProvider) {
    const testnet = process.env.NETWORK === "goerli"

    const quoterContractAddr = testnet ? goerli_env.QOUTER_ADDR : env.QOUTER_ADDR
    const quoterContract = new ethers.Contract(quoterContractAddr, QuoterABI, provider)
    
    const wallet = new Wallet(process.env.PRIVATE_KEY || "");
    
    const poolAddress = testnet ? goerli_env.WETH_DAT_POOL_ADDR : env.USDC_WETH_POOL_ADDR
    const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, provider)

    const BUNDLE_EXECUTOR_V3_ADDR = process.env.BUNDLE_EXECUTOR_V3_ADDR || ""

    console.log("amount in:", amountIn.toString())
  
    console.log("goerli is on:", process.env.NETWORK === "goerli")
    console.log("pool address:", poolAddress)
    console.log("bundle executor V3 address:", BUNDLE_EXECUTOR_V3_ADDR)
  
    const [immutables, state] = await Promise.all([getPoolImmutables(poolContract), getPoolState(poolContract)])
    console.log("pool state:", state)
    console.log("sqrtPriceX96:", state.sqrtPriceX96.toString())
    console.log("token0:", immutables.token0)
    console.log("token1:", immutables.token1)
    console.log("fee:", immutables.fee)
  
    const bundleExecutor = new Contract(BUNDLE_EXECUTOR_V3_ADDR, BUNDLE_EXECUTOR_ABI_V3, provider)
    // console.log("bundle executor:", bundleExecutor)
  
    // quoteExactInputSingle, quoteExactInput, quoteExactOutputSingle, quoteExactOutput
    const quotedAmountOut = await quoterContract.callStatic.quoteExactInputSingle(
      immutables.token1, // address tokenIn,
      immutables.token0, // address tokenOut,
      immutables.fee, // uint24 fee,
      amountIn.toString(), // uint256 amountIn,
      0 // uint160 sqrtPriceLimitX96
    )
    console.log("expected amount out:", quotedAmountOut.toString())
  
    // const priceLimit = state.sqrtPriceX96.mul(BigNumber.from(8))
    // console.log("price limit:", priceLimit)
  
    const tx = await bundleExecutor.populateTransaction.uniswapWethV3_OneForZero(amountIn)
    tx.from = wallet.address
    // console.log("tx:", tx)
  
    const estimateGas = await provider.estimateGas(
      {
        ...tx,
      }
    )
  
    tx.gasLimit = estimateGas.mul(2) // BigNumber.from(100000000) // estimateGas.mul(2)
    tx.gasPrice = (await provider.getGasPrice()).mul(2)
    // tx.gasPrice = tx.gasPrice.mul(2)
    tx.nonce = await provider.getTransactionCount(wallet.address, "latest")
    // console.log('tx:', tx)
  
    const signedTx = await wallet.signTransaction(tx)
    console.log("transaction signed", signedTx)
    
    // const sentTx = await provider.sendTransaction(signedTx)
    // console.log("sentTx:", sentTx)
  
    // const receipt = await provider.waitForTransaction(sentTx.hash, 1, 100000);
    // console.log("receipt:", receipt)
  }