import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
// import "@openzeppelin/hardhat-upgrades";
// require('@openzeppelin/hardhat-upgrades');

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || ""
const GOERLI_RPC_URL = process.env.ETH_RPC_URL || ""
const POLYGON_MAINNET_RPC_URL = process.env.POLYGON_MAINNET_RPC_URL || ""
const PRIVATE_KEY = process.env.PRIVATE_KEY || ""

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.1",
      },
      {
        version: "0.6.12",
        settings: {},
      },
      {
        version: "0.5.16",
      },
    ],
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      // If you want to do some forking, uncomment this
      forking: {
        url: MAINNET_RPC_URL
      },
      chainId: 31337,
    },
    localhost: {
      chainId: 31337,
    },
    goerli: {
      url: GOERLI_RPC_URL,
      accounts: [PRIVATE_KEY],
      //accounts: {
      //     mnemonic: MNEMONIC,
      // },
      // saveDeployments: true,
      chainId: 5,
    },
    mainnet: {
      url: MAINNET_RPC_URL,
      accounts: PRIVATE_KEY !== undefined ? [PRIVATE_KEY] : [],
      //   accounts: {
      //     mnemonic: MNEMONIC,
      //   },
      // saveDeployments: true,
      chainId: 1,
    },
    polygon: {
      url: POLYGON_MAINNET_RPC_URL,
      accounts: PRIVATE_KEY !== undefined ? [PRIVATE_KEY] : [],
      // saveDeployments: true,
      chainId: 137,
    },
  },
};

export default config;
