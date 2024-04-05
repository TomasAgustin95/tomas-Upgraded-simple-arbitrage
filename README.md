Upgraded simple-arbitrage
================
This upgrade supports arbitraging between uniswap v2 and uniswap v3 pools by discovering arbitrage opportunities between v2 and v3 pools.

The repository is tested and works succesfully on goerli testnet, however failed to compete with other arbitrage bots on mainnet due to lack of multi-pool routing strategy.

The repository is free for anyone to use, the [FlashBotsUniswapQuery](https://etherscan.io/address/0x657c2be334ea5d9eb55635796f8770af8ac3b243) and [FlashBotsMultiCall (executer)](https://etherscan.io/address/0x41735c26032cA8539ba310B0e8E6F1Ab94a6c9B8) contracts are deployed on mainnet and the query contract is verified.

To use this repository, do remember to deploy your own executer contract so you own your earnings.

If you find this repository helpful, please consider giving a star, happy coding.

Environment Variables
=====================
- **ETHEREUM_RPC_URL** - Ethereum RPC endpoint. Can not be the same as FLASHBOTS_RPC_URL
- **PRIVATE_KEY** - Private key for the Ethereum EOA that will be submitting Flashbots Ethereum transactions
- **FLASHBOTS_RELAY_SIGNING_KEY** _[Optional, default: random]_ - Flashbots submissions require an Ethereum private key to sign transaction payloads. This newly-created account does not need to hold any funds or correlate to any on-chain activity, it just needs to be used across multiple Flashbots RPC requests to identify requests related to same searcher. Please see https://docs.flashbots.net/flashbots-auction/searchers/faq#do-i-need-authentication-to-access-the-flashbots-relay
- **HEALTHCHECK_URL** _[Optional]_ - Health check URL, hit only after successfully submitting a bundle.
- **MINER_REWARD_PERCENTAGE** _[Optional, default 80]_ - 0 -> 100, what percentage of overall profitability to send to miner.

Usage
======================
1. Generate a new bot wallet address and extract the private key into a raw 32-byte format.
2. Deploy the included [executor.sol](contracts/executor.sol) to Ethereum, from a secured account, with the address of the newly created wallet as the constructor argument
3. Transfer WETH to the newly deployed BundleExecutor

_It is important to keep both the bot wallet private key and bundleExecutor owner private key secure. The bot wallet attempts to not lose WETH inside an arbitrage, but a malicious user would be able to drain the contract._

```
$ npm install
$ PRIVATE_KEY=__PRIVATE_KEY_FROM_ABOVE__ \
    BUNDLE_EXECUTOR_ADDRESS=__DEPLOYED_ADDRESS_FROM_ABOVE__ \
    FLASHBOTS_RELAY_SIGNING_KEY=__RANDOM_ETHEREUM_PRIVATE_KEY__ \
      npm run start
```

# TODO 

* support uniswap v3 swap transaction off-chain simulation 

* strategy <= graph theory, detect all possible pairs, mev-node
  * WETH -> WETH/A -> A/B -> B/WETH -> WETH
  * DAI -> DAI/A -> A/B -> B/DAI -> DAI

* this is about market info 
  * currently, after UniswappyV2EthPair.getUniswapMarketsByToken(provider, FACTORY_ADDRESSES) call markets.marketsByToken stays still, even after update reserve, if balance of reserver becomes greater than defined threshold they are still not included, which may now contains considerable profit to made
    * (method 1) => eliminate markets below balance threshold and do not query Reserve_Update() for them
      this should speed up searching and focused on the important pairs
    * (method 2) => after update reserve, find markets with balance over threshold to include and remove markets with balances lower than threshold, this need to maintain a dynamic markets.marketsByToken object, which should make things more complicated

* optimize gas cost by using bytecode call on bundle executor?
* How to black list scam tokens to speed up search
* maybe adding flashloan? (aave, dydx, uniswapV2 native one? ...)
* better way to estimate buy/sell price other than setting ETHER.div(100) when arbitrage.evaluateMarkets(markets.marketsByToken)?
