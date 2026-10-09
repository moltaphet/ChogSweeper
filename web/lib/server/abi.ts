import { parseAbi } from "viem";

export const nftReadAbi = parseAbi([
  "function name() view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function uri(uint256 id) view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
]);

export const transferEvent = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"])[0];
