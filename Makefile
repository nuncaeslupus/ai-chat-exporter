# AI Chat Exporter — thin wrappers over pnpm scripts + extension dev loop.

ARSENAL_REPO    ?= https://github.com/nuncaeslupus/claude-arsenal.git
ARSENAL_REF     ?= v0.20.5
ARSENAL_PLUGINS ?= core
EXT_DIR         ?= dist/chrome
CDP_PORT        ?= 9333

.PHONY: help install dev build test lint typecheck validate package release-check clean chrome update-skills

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

validate: ## lint + typecheck + tests
	pnpm validate

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

update-skills: ## Re-vendor claude-arsenal skills into .claude/skills
	@tmp=$$(mktemp -d); trap 'rm -rf $$tmp' EXIT; \
	git clone --depth 1 --branch $(ARSENAL_REF) $(ARSENAL_REPO) $$tmp >/dev/null 2>&1 && \
	bash $$tmp/scripts/vendor-skills.sh --src $$tmp --dest .claude/skills --plugins $(ARSENAL_PLUGINS)
