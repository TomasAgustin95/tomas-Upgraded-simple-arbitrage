//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.16;

pragma experimental ABIEncoderV2;

// import "@openzeppelin/contracts/utils/Strings.sol";

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
}

interface IERC20 {
    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint);
    function balanceOf(address owner) external view returns (uint);
    function allowance(address owner, address spender) external view returns (uint);

    function approve(address spender, uint value) external returns (bool);
    function transfer(address to, uint value) external returns (bool);
    function transferFrom(address from, address to, uint value) external returns (bool);
}

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint) external;
}

/// @title Callback for IUniswapV3PoolActions#swap
/// @notice Any contract that calls IUniswapV3PoolActions#swap must implement this interface
interface IUniswapV3SwapCallback {
    /// @notice Called to `msg.sender` after executing a swap via IUniswapV3Pool#swap.
    /// @dev In the implementation you must pay the pool tokens owed for the swap.
    /// The caller of this method must be checked to be a UniswapV3Pool deployed by the canonical UniswapV3Factory.
    /// amount0Delta and amount1Delta can both be 0 if no tokens were swapped.
    /// @param amount0Delta The amount of token0 that was sent (negative) or must be received (positive) by the pool by
    /// the end of the swap. If positive, the callback must send that amount of token0 to the pool.
    /// @param amount1Delta The amount of token1 that was sent (negative) or must be received (positive) by the pool by
    /// the end of the swap. If positive, the callback must send that amount of token1 to the pool.
    /// @param data Any data passed through by the caller via the IUniswapV3PoolActions#swap call
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external;
}

abstract contract IUniswapV3Factory {
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;
}

interface IUniswapV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
    function fee() external view returns (uint24);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

// ********************************
    // event Amount(int256 amount0, int256 amount1, string message);
    // event AmountUint(uint256 amount0, uint256 amount1, string message);
    // event decodeString(address s);

    // function V3toV2_test(IUniswapV3Pool pool, IUniswapV2Pair pair, int256 amountIn) public { // onlyExecutor

    //     // require(msg.sender == executor || msg.sender == address(this));

    //     // WETH to DAI
    //     (int256 amount0, int256 amount1) = pool.swap(
    //         address(pair),
    //         false,
    //         amountIn, // 1000000000000000
    //         MAX_SQRT_RATIO,
    //         ""
    //     );

    //     emit Amount(amount0, amount1, "amount");

    //     uint amountOut = uint(amountIn) * uint(9) / uint(10);
    //     pair.swap(
    //         0, // DAI
    //         amountOut, // WETH
    //         address(this), 
    //         ""
    //     );
    // }

    // function V2toV3_test(IUniswapV3Pool pool, IUniswapV2Pair pair, int256 amountIn, uint256 tokenOut) public { // onlyExecutor

    //     // require(msg.sender == executor || msg.sender == address(this));

    //     WETH.transfer(address(pair), uint256(amountIn));
    //     pair.swap(
    //         tokenOut, // DAI
    //         0, // WETH
    //         address(this), 
    //         ""
    //     );

    //     // WETH to DAI
    //     (int256 amount0, int256 amount1) = pool.swap(
    //         address(this),
    //         true,
    //         int256(tokenOut), // 1000000000000000
    //         MIN_SQRT_RATIO,
    //         ""
    //     );

    //     emit Amount(amount0, amount1, "amount");
    // }

    // function uniswapWethV2(uint256 _wethAmountToFirstMarket, uint256 _ethAmountToCoinbase, address[] memory _targets, bytes[] memory _payloads) external onlyExecutor payable {
    //     require (_targets.length == _payloads.length);
    //     uint256 _wethBalanceBefore = WETH.balanceOf(address(this));
    //     WETH.transfer(_targets[0], _wethAmountToFirstMarket);
    //     for (uint256 i = 0; i < _targets.length; i++) {
    //         (bool _success, bytes memory _response) = _targets[i].call(_payloads[i]);
    //         require(_success); _response;
    //     }

    //     uint256 _wethBalanceAfter = WETH.balanceOf(address(this));
    //     require(_wethBalanceAfter > _wethBalanceBefore + _ethAmountToCoinbase);
    //     if (_ethAmountToCoinbase == 0) return;

    //     uint256 _ethBalance = address(this).balance;
    //     if (_ethBalance < _ethAmountToCoinbase) {
    //         WETH.withdraw(_ethAmountToCoinbase - _ethBalance);
    //     }
    //     block.coinbase.transfer(_ethAmountToCoinbase);
    // }
// ********************************

contract FlashBotsMultiCall {

    address private immutable owner;
    address private immutable executor;
    IWETH private constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    IUniswapV3Factory private constant FACTORY = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

    /// @dev The minimum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MIN_TICK)
    uint160 internal constant MIN_SQRT_RATIO = 4295128740; // 4295128739
    /// @dev The maximum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MAX_TICK)
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341; // 1461446703485210103287273052203988822378723970342

    function bytesToAddress(bytes memory bys) private pure returns (address addr) {
        assembly {
            addr := mload(add(bys,20))
        } 
    }

    function uniswapWethV3_OneForZero(IUniswapV3Pool pool, address recepient, int256 amountIn, bytes calldata data) public {
        require(msg.sender == address(this));

        pool.swap(
            recepient,
            false,
            amountIn, // 1000000000000000
            MAX_SQRT_RATIO,
            data
        );

        // emit Amount(amount0, amount1, "amount");
    }

    function uniswapWethV3_ZeroForOne(IUniswapV3Pool pool, address recepient, int256 amountIn, bytes calldata data) public {
        require(msg.sender == address(this));
        
        pool.swap(
            recepient,
            true,
            amountIn, // 1000000000000000
            MIN_SQRT_RATIO,
            data
        );

        // emit Amount(amount0, amount1, "amount");
    }

    modifier onlyExecutor() {
        require(msg.sender == executor);
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    constructor(address _executor) payable {
        owner = msg.sender;
        executor = _executor;

        if (msg.value > 0) {
            WETH.deposit{value: msg.value}();
        }
    }

    receive() external payable {}

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {

        // IUniswapV3Pool spl = IUniswapV3Pool(msg.sender);
        require(
            FACTORY.getPool(
                IUniswapV3Pool(msg.sender).token0(),
                IUniswapV3Pool(msg.sender).token1(),
                IUniswapV3Pool(msg.sender).fee()
            ) == msg.sender
        );

        // emit decodeString(bytesToAddress(data));

        if (amount0Delta > 0) {
            IERC20(bytesToAddress(data)).transfer(msg.sender, uint(amount0Delta));
        } else if (amount1Delta > 0) {
            IERC20(bytesToAddress(data)).transfer(msg.sender, uint(amount1Delta));
        }

        // emit Amount(amount0Delta, amount1Delta, "delta");
        // emit AmountUint(uint(amount0Delta), uint(amount1Delta), "uint delta");
    }

    function uniswapWeth(uint256 _ethAmountToCoinbase, address[] memory _targets, bytes[] memory _payloads) external onlyExecutor payable {
        // require (_targets.length == _payloads.length, "fucked up call length");
        require (_targets.length == _payloads.length);
        uint256 _wethBalanceBefore = WETH.balanceOf(address(this));
        // WETH.transfer(_targets[0], _wethAmountToFirstMarket);
        for (uint256 i = 0; i < _targets.length; i++) {
            (bool _success, bytes memory _response) = _targets[i].call(_payloads[i]);
            require(_success);
            // require(_success, string(abi.encodePacked("i=", Strings.toString(i), ": _targets[i].call(_payloads[i]) failed")));
            _response;
        }

        // require(_wethBalanceAfter > _wethBalanceBefore + _ethAmountToCoinbase, "not earning shit");
        require(WETH.balanceOf(address(this)) > _wethBalanceBefore + _ethAmountToCoinbase);
        // if (_ethAmountToCoinbase == 0) return;

        // uint256 _ethBalance = address(this).balance;
        // if (_ethBalance < _ethAmountToCoinbase) {
        //     WETH.withdraw(_ethAmountToCoinbase - _ethBalance);
        // }
        block.coinbase.transfer(_ethAmountToCoinbase);
    }

    function call(address payable _to, uint256 _value, bytes calldata _data) external onlyOwner payable returns (bytes memory) {
        require(_to != address(0));
        (bool _success, bytes memory _result) = _to.call{value: _value}(_data);
        require(_success);
        return _result;
    }

    function withdrawAll() external onlyOwner {
        uint256 wethBalance = WETH.balanceOf(address(this));
        if (wethBalance > 0) {
            WETH.withdraw(wethBalance);
        }
        (bool _success,) = owner.call{value: address(this).balance}("");
        require(_success);
    }
}
