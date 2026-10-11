// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
/// Just enough of Multicall3 (aggregate3) for viem's `multicall`, deployed at the canonical address on the local test chain.
contract Multicall3Lite {
    struct Call3 { address target; bool allowFailure; bytes callData; }
    struct Result { bool success; bytes returnData; }
    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory r) {
        r = new Result[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call(calls[i].callData);
            if (!ok && !calls[i].allowFailure) { assembly { revert(add(ret, 0x20), mload(ret)) } }
            r[i] = Result(ok, ret);
        }
    }
    function getBlockNumber() external view returns (uint256) { return block.number; }
    function getEthBalance(address a) external view returns (uint256) { return a.balance; }
}
