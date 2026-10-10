// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
contract MockNFT is ERC721 {
    constructor(string memory n) ERC721(n, "MOCK") {}
    function mint(address to, uint256 id) external { _mint(to, id); }
}
contract FakeNFT {
    function transferFrom(address, address, uint256) external {}
    function ownerOf(uint256) external pure returns (address) { return address(0xdead); }
    function balanceOf(address) external pure returns (uint256) { return 0; }
}
contract GasBurner { function balanceOf(address) external pure returns (uint256) { while (true) {} } }
contract Garbage { fallback() external { assembly { mstore(0, 1) return(0, 5) } } }
contract Reverting { function balanceOf(address) external pure returns (uint256) { revert("no"); } }
