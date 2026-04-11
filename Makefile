.PHONY: help build run test clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

build: ## Build the torg binary
	go build -o torg .

run: build ## Build and run with current directory
	./torg .

test: ## Run tests
	go test ./...

clean: ## Remove build artifacts
	rm -f torg
