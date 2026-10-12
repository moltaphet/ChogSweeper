# Convenience targets. Loads .env (git-ignored) when present.
-include .env
export

RPC ?= $(if $(MONAD_TESTNET_RPC_URL),$(MONAD_TESTNET_RPC_URL),https://testnet-rpc.monad.xyz/)
CHAIN_ID ?= 10143

.PHONY: test test-js test-ui dry-run deploy export test-collections smoke-testnet e2e-local verify-onchain

test:            ## contracts + indexer (if present) + web test suites
	forge test
	@if [ -d indexer ]; then cd indexer && npm test --silent; else echo "indexer/ not present, skipping its tests"; fi
	cd web && npx vitest run

test-js:         ## contract behaviour tests on an in-process EVM (no Foundry needed): fees, refunds, verified list, tiers
	cd ops/contract-tests && npm test --silent

test-ui:         ## browser end-to-end on a throw-away local chain with a fake wallet (needs: cd ops/ui-e2e && npm i && npx playwright install chromium)
	cd ops/ui-e2e && npm test

dry-run:         ## simulate the deployment against the live RPC; sends nothing
	forge script script/DeployChogSweeper.s.sol --rpc-url $(RPC)

deploy:          ## broadcast to Monad Testnet, then export addresses / ABIs / env files
	forge script script/DeployChogSweeper.s.sol --rpc-url $(RPC) --broadcast
	node ops/export-deployment.mjs --chain-id $(CHAIN_ID) --rpc $(RPC)

export:          ## re-run only the export (e.g. after a slow confirmation)
	node ops/export-deployment.mjs --chain-id $(CHAIN_ID) --rpc $(RPC)

test-collections: ## testnet only: deploy 4 mock partner collections, mint some to SEED_MINT_TO, verify them on-chain and in the config
	@test -f deployments/$(CHAIN_ID).json || { echo "No deployments/$(CHAIN_ID).json yet: run 'make deploy' first."; exit 1; }
	SWEEPER_ADDRESS=$$(node -p "require('./deployments/$(CHAIN_ID).json').sweeper.address") forge script script/DeployTestCollections.s.sol --rpc-url $(RPC) --broadcast
	node ops/add-test-collections.mjs --chain-id $(CHAIN_ID)
	node ops/export-deployment.mjs --chain-id $(CHAIN_ID) --rpc $(RPC)

verify-onchain:  ## read the deployed configuration straight from the chain
	@test -f deployments/$(CHAIN_ID).json || { echo "No deployments/$(CHAIN_ID).json yet: run 'make deploy' first."; exit 1; }
	@S=$$(node -p "require('./deployments/$(CHAIN_ID).json').sweeper.address"); \
	echo "ChogSweeper $$S"; \
	for f in "owner()(address)" "pendingOwner()(address)" "treasury()(address)" "platformFee()(uint128)" "chogCollection()(address)" "tradeCount()(uint256)"; do \
	  printf "  %-26s" "$$f"; cast call $$S "$$f" --rpc-url $(RPC); done

smoke-testnet:   ## real-network trade between two funded wallets (PRIVATE_KEY_A / PRIVATE_KEY_B), optional API=https://...
	node ops/smoke.mjs --rpc $(RPC) --chain-id $(CHAIN_ID) $(if $(API),--api $(API),)

e2e-local:       ## whole stack on a local chain: anvil + deploy + Postgres + indexer + API + smoke test
	cd ops && node e2e-local.mjs
