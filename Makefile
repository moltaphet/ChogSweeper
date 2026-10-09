# Convenience targets. Loads .env (git-ignored) when present.
-include .env
export

RPC ?= $(if $(MONAD_TESTNET_RPC_URL),$(MONAD_TESTNET_RPC_URL),https://testnet-rpc.monad.xyz/)
CHAIN_ID ?= 10143

.PHONY: test dry-run deploy export smoke-testnet e2e-local verify-onchain

test:            ## contracts + indexer + web test suites
	forge test
	cd indexer && npm test --silent
	cd web && npx vitest run

dry-run:         ## simulate the deployment against the live RPC; sends nothing
	forge script script/DeployChogSweeper.s.sol --rpc-url $(RPC)

deploy:          ## broadcast to Monad Testnet, then export addresses / ABIs / env files
	forge script script/DeployChogSweeper.s.sol --rpc-url $(RPC) --broadcast
	node ops/export-deployment.mjs --chain-id $(CHAIN_ID) --rpc $(RPC)

export:          ## re-run only the export (e.g. after a slow confirmation)
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
