import { parseAbi } from "viem";

export const sweeperEvents = parseAbi([
  "struct Asset { address nft; uint256 tokenId; }",
  "event TradeCreated(uint256 indexed tradeId, address indexed maker, address indexed taker, Asset[] offered, uint256 offeredMon, Asset[] wanted, uint256 wantedMon, uint64 expiry, uint256 fee)",
  "event TradeAccepted(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 fee)",
  "event TradeCancelled(uint256 indexed tradeId, address indexed maker)",
  "event TradeDeclined(uint256 indexed tradeId, address indexed maker, address indexed taker)",
]);

export const erc721Events = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);

export const erc721ReadAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
