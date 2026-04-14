.PHONY: help build run test test-js clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

build: ## Build the torg binary
	go build -o torg .

run: build ## Build and run with current directory
	./torg .

test: ## Run Go tests
	go test ./...

test-js: ## Run JS tree tests (open in browser)
	@echo "Open http://localhost:8080/test.html in your browser"
	@echo "(server must be running)"

clean: ## Remove build artifacts
	rm -f torg
