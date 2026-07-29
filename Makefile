# AI Chat Exporter — thin wrappers over pnpm scripts + extension dev loop.

ARSENAL_REPO    ?= https://github.com/nuncaeslupus/claude-arsenal.git
ARSENAL_REF     ?= v0.23.0
ARSENAL_PLUGINS ?= core
EXT_DIR         ?= dist/chrome
CDP_PORT        ?= 9333

.PHONY: help install dev build test lint typecheck validate package release-check clean chrome update-skills update-arsenal

help:
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	pnpm install

dev: ## Rebuild Chrome bundle on every change
	pnpm dev:chrome

build: ## Production build (chrome + firefox)
	pnpm build

test: ## Run the test suite once
	pnpm test:run

lint: ## ESLint
	pnpm lint

typecheck: ## tsc --noEmit
	pnpm typecheck

# `pnpm validate` (lint+typecheck+test) is NOT used here: eslint reports ~1157
# pre-existing errors CI deliberately routes around (see queue task lo-0f01).
# `validate`/`release-check` mirror what CI's `validate` job actually runs.
validate: build ## lint + format + typecheck + tests + release-config checks (mirrors CI)
	pnpm lint
	pnpm format:check
	node build/check-release.cjs version
	node build/check-release.cjs node
	pnpm typecheck
	pnpm test:coverage
	node build/check-release.cjs manifest

package: build ## Build and zip both stores + source
	pnpm package:all

release-check: validate package ## Everything a release needs to be green
	@ls -la dist/*.zip

chrome: ## Launch headless Chrome with the unpacked extension (CDP on $(CDP_PORT))
	@test -f $(EXT_DIR)/manifest.json || { echo "no build at $(EXT_DIR) — run 'make build'"; exit 1; }
	google-chrome --headless=new --remote-debugging-port=$(CDP_PORT) \
	  --user-data-dir=$$(mktemp -d) --no-first-run \
	  --disable-extensions-except=$(PWD)/$(EXT_DIR) --load-extension=$(PWD)/$(EXT_DIR) about:blank

clean: ## Remove build output
	rm -rf dist build/.vite

update-arsenal: update-skills ## Re-vendor the arsenal AND refresh claude-arsenal/ from it
	@python3 .claude/skills/init/scripts/init.py --repo-path . --silent
	@echo "runtime bundle: $$(cat claude-arsenal/.bundle-version)"
	@bash tests/gate_run_test.sh >/dev/null && bash tests/release_gate_test.sh >/dev/null \
		&& echo "harness tests: ok" || echo "harness tests: FAILED — inspect before committing"

update-skills: ## Re-vendor claude-arsenal skills into .claude/skills
	@tmp=$$(mktemp -d); trap 'rm -rf $$tmp' EXIT; \
	git clone --depth 1 --branch $(ARSENAL_REF) $(ARSENAL_REPO) $$tmp >/dev/null 2>&1 && \
	bash $$tmp/scripts/vendor-skills.sh --src $$tmp --dest .claude/skills --plugins $(ARSENAL_PLUGINS)
