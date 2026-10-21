# ChogSweeper — Hackathon submission notes

## Short project description

ChogSweeper is a peer-to-peer NFT swap protocol on Monad. A maker escrows a bundle of ERC-721s and/or native MON, then names the NFT and MON bundle they want in return. A designated wallet or any visitor can accept an eligible offer. The escrow transfers both sides atomically, or lets the maker cancel and recover the escrow. The current app and contracts run on Monad Testnet and are experimental, unaudited software.

## Two-minute demo outline

1. **Show the market (15 seconds):** open the public-trades page while disconnected and explain that open offers are publicly visible.
2. **Prepare test assets (25 seconds):** open Test Faucet, connect a Monad Testnet wallet, get test MON, and mint one or two practice NFTs.
3. **Create an offer (35 seconds):** select an NFT, choose Public offer, select the requested NFT/MON terms and expiry, approve the escrow if prompted, then confirm creation.
4. **Accept from another account (30 seconds):** switch to a second wallet account, find the offer in Public Trades, approve the requested NFT if needed, and accept it.
5. **Show proof (15 seconds):** open the transaction receipt/explorer link and show the completed trade in History or Activity.

There are no seeded offers. Create the offer during the demo, and use two funded testnet accounts if you want to show both sides in one recording. Never use real assets or a production wallet for this walkthrough.

## Differentiation

ChogSweeper focuses on atomic peer-to-peer exchange: one offer can bundle NFTs from verified collections with native MON on either side, and settlement is handled by an escrow contract. The project is not a general NFT listing or auction marketplace; it focuses on direct and open-counter offers between wallets.

## Known limitations to disclose

- Monad Testnet only; no mainnet launch is supported.
- The software and contracts are unaudited and experimental.
- Practice collections are mocks or unofficial artwork replicas; the official Chog NFT collection has not been verified or integrated.
- Public offers must be created by a wallet; the project does not seed or fabricate demo trades.
- Expired escrow is reclaimed when the maker cancels; expiry does not automatically transfer assets back.
- Marketplace history and aggregate activity depend on the hosted indexer and database.
