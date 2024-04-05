//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.16;

pragma experimental ABIEncoderV2;

abstract contract Quoter {

    /// @dev Transient storage variable used to check a safety condition in exact output swaps.
    uint256 private amountOutCached;

    // function getPool(
    //     address tokenA,
    //     address tokenB,
    //     uint24 fee
    // ) private view returns (IUniswapV3Pool);

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes memory path
    ) external view {
    }

    /// @dev Parses a revert reason that should contain the numeric quote
    // function parseRevertReason(bytes memory reason) private pure returns (uint256);
    // {
    //     if (reason.length != 32) {
    //         if (reason.length < 68) revert('Unexpected error');
    //         assembly {
    //             reason := add(reason, 0x04)
    //         }
    //         revert(abi.decode(reason, (string)));
    //     }
    //     return abi.decode(reason, (uint256));
    // }

    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) public virtual returns (uint256 amountOut); 
    // {
    //     bool zeroForOne = tokenIn < tokenOut;

    //     try
    //         getPool(tokenIn, tokenOut, fee).swap(
    //             address(this), // address(0) might cause issues with some tokens
    //             zeroForOne,
    //             amountIn.toInt256(),
    //             sqrtPriceLimitX96 == 0
    //                 ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
    //                 : sqrtPriceLimitX96,
    //             abi.encodePacked(tokenIn, fee, tokenOut)
    //         )
    //     {} catch (bytes memory reason) {
    //         return parseRevertReason(reason);
    //     }
    // }

    function quoteExactInput(bytes memory path, uint256 amountIn) external virtual returns (uint256 amountOut);
    // {
    //     while (true) {
    //         bool hasMultiplePools = path.hasMultiplePools();

    //         (address tokenIn, address tokenOut, uint24 fee) = path.decodeFirstPool();

    //         // the outputs of prior swaps become the inputs to subsequent ones
    //         amountIn = quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);

    //         // decide whether to continue or terminate
    //         if (hasMultiplePools) {
    //             path = path.skipToken();
    //         } else {
    //             return amountIn;
    //         }
    //     }
    // }

    function quoteExactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint160 sqrtPriceLimitX96
    ) public virtual returns (uint256 amountIn); 
    // {
    //     bool zeroForOne = tokenIn < tokenOut;

    //     // if no price limit has been specified, cache the output amount for comparison in the swap callback
    //     if (sqrtPriceLimitX96 == 0) amountOutCached = amountOut;
    //     try
    //         getPool(tokenIn, tokenOut, fee).swap(
    //             address(this), // address(0) might cause issues with some tokens
    //             zeroForOne,
    //             -amountOut.toInt256(),
    //             sqrtPriceLimitX96 == 0
    //                 ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
    //                 : sqrtPriceLimitX96,
    //             abi.encodePacked(tokenOut, fee, tokenIn)
    //         )
    //     {} catch (bytes memory reason) {
    //         if (sqrtPriceLimitX96 == 0) delete amountOutCached; // clear cache
    //         return parseRevertReason(reason);
    //     }
    // }

    function quoteExactOutput(bytes memory path, uint256 amountOut) external virtual returns (uint256 amountIn); 
    // {
    //     while (true) {
    //         bool hasMultiplePools = path.hasMultiplePools();

    //         (address tokenOut, address tokenIn, uint24 fee) = path.decodeFirstPool();

    //         // the inputs of prior swaps become the outputs of subsequent ones
    //         amountOut = quoteExactOutputSingle(tokenIn, tokenOut, fee, amountOut, 0);

    //         // decide whether to continue or terminate
    //         if (hasMultiplePools) {
    //             path = path.skipToken();
    //         } else {
    //             return amountOut;
    //         }
    //     }
    // }
}

interface IUniswapV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external virtual returns (int256 amount0, int256 amount1);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);

    // function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

abstract contract UniswapV3Factory  {
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

abstract contract UniswapV2Factory  {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;
    function allPairsLength() external view virtual returns (uint);
}

// In order to quickly load up data from Uniswap-like market, this contract allows easy iteration with a single eth_call
contract FlashBotsUniswapQuery {
    uint160 internal constant MIN_SQRT_RATIO = 4295128740; // 4295128739
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341; 

    function parseRevertReason(bytes memory reason) private pure returns (uint256) {
        if (reason.length != 32) {
            if (reason.length < 68) revert('Unexpected error');
            assembly {
                reason := add(reason, 0x04)
            }
            revert(abi.decode(reason, (string)));
        }
        return abi.decode(reason, (uint256));
    }

    // , bool[4][] calldata feeOn
    function getReservesByPairs(Quoter quoter, IUniswapV2Pair[] calldata _pairs, address WETH, address[] calldata tokenOut, uint24[4] calldata fee, bool[4][] calldata feeOn, uint256 amountIn) external returns (uint256[6][] memory) {
        // function quoteExactInputSingle(
        //     address tokenIn,
        //     address tokenOut,
        //     uint24 fee,
        //     uint256 amountIn,
        //     uint160 sqrtPriceLimitX96
        // ) public virtual returns (uint256 amountOut); 

        uint256[6][] memory result = new uint256[6][](_pairs.length);
        for (uint i = 0; i < _pairs.length; i++) {
            (result[i][0], result[i][1],) = _pairs[i].getReserves();

            for (uint j = 0; j < 4; j++) {
                // result[i][2+j] = quoter.quoteExactInputSingle(WETH, tokenOut[i], fee[j], amountIn, 0);
                // if (feeOn[i][j]) {
                //     result[i][2+j] = quoter.quoteExactInputSingle(WETH, tokenOut[i], fee[j], amountIn, 0);
                // }
                if (feeOn[i][j]) {
                    try quoter.quoteExactInputSingle(WETH, tokenOut[i], fee[j], amountIn, 0) returns (uint256 amountOut) {
                        result[i][2+j] = amountOut;
                    } catch {
                        result[i][2+j] = 0;
                    }
                } else {
                    result[i][2+j] = 0;
                }
            }
        }
        return result;
    }

    // function getReservesByPairs(Quoter quoter, IUniswapV2Pair[] calldata _pairs, address[] calldata tokenIn, address[] calldata tokenOut, uint24[][] calldata fee, uint256 amountIn) external returns (uint256[3][] memory, uint256[][] memory) {
    //     // function quoteExactInputSingle(
    //     //     address tokenIn,
    //     //     address tokenOut,
    //     //     uint24 fee,
    //     //     uint256 amountIn,
    //     //     uint160 sqrtPriceLimitX96
    //     // ) public virtual returns (uint256 amountOut); 

    //     uint256[3][] memory result = new uint256[3][](_pairs.length);
    //     uint256[][] memory amountOut;
    //     for (uint i = 0; i < _pairs.length; i++) {
    //         (result[i][0], result[i][1], result[i][2]) = _pairs[i].getReserves();

    //         for (uint j = 0; j < fee[i].length; j++) {
    //             amountOut[i][j] = quoter.quoteExactInputSingle(tokenIn[i], tokenOut[i], fee[i][j], amountIn, 0);
    //         }
    //     }
    //     return (result, amountOut);
    // }

    function getPairsByIndexRange(UniswapV2Factory _uniswapFactory, UniswapV3Factory _uniswapFactoryV3, uint24[4] calldata feeTires, uint256 _start, uint256 _stop) external view returns (address[7][] memory)  {
        uint256 _allPairsLength = _uniswapFactory.allPairsLength();
        if (_stop > _allPairsLength) {
            _stop = _allPairsLength;
        }
        require(_stop >= _start, "start cannot be higher than stop");
        uint256 _qty = _stop - _start;

        address[7][] memory result = new address[7][](_qty);
        for (uint i = 0; i < _qty; i++) {
            IUniswapV3Pool _uniswapPair = IUniswapV3Pool(_uniswapFactory.allPairs(_start + i));
            result[i][0] = _uniswapPair.token0();
            result[i][1] = _uniswapPair.token1();
            result[i][2] = address(_uniswapPair);
            for (uint j = 0; j < feeTires.length; j++) {
                result[i][3+j] = _uniswapFactoryV3.getPool(result[i][0], result[i][1], feeTires[j]);
            }
        }
        return result;
    }
}