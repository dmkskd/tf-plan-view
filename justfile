# Justfile for tf plan view
# Run `just` or `just --list` to see available commands

set shell := ["bash", "-cu"]

# Default recipe: list available commands
default:
    @just --list

# Start Vite development server with hot module replacement (HMR)
dev port="3000":
    npx vite src --port {{port}}

# Build the single self-contained HTML asset (dist/index.html)
build: typecheck
    node scripts/build-single-html.js

# Run the entire test suite and regression baselines
test: typecheck build test-unit test-boot test-render test-pure test-parse test-layout
    @echo "✅ All tests and regression baselines passed!"

# Run unit assertions (optional suite filter, e.g. `just test-unit placement`)
test-unit suite="":
    node tools/test.js {{suite}}

# Run headless DOM boot check
test-boot:
    node tools/check-boot.js

# Run headless DOM interactive render check
test-render:
    node tools/check-render.js

# Verify pure functions against baseline
test-pure:
    node tools/check-pure.js | diff tools/baseline/check-pure.txt -

# Verify parser and validation messages against baseline
test-parse:
    node tools/check-parse.js | diff tools/baseline/check-parse.txt -

# Verify layout coordinates and hierarchy against baseline
test-layout:
    node tools/check-layout.js | diff tools/baseline/check-layout.txt -

# Re-record all regression baselines when intentional changes are made
record-baselines:
    node tools/check-pure.js > tools/baseline/check-pure.txt
    node tools/check-parse.js > tools/baseline/check-parse.txt
    node tools/check-layout.js > tools/baseline/check-layout.txt
    @echo "✅ All baselines re-recorded in tools/baseline/"

# Run TypeScript type verification
typecheck:
    npx tsc --noEmit
    @echo "✅ TypeScript type check passed with 0 errors!"

# Validate TypeScript types and script syntax
check: typecheck
    @echo "Checking script syntax..."
    @for f in `find scripts tools -name "*.js"`; do node --check "$f" || exit 1; done
    @echo "✅ All files passed syntax verification!"

# Build and open the self-contained app directly in the default browser
open: build
    @open dist/index.html 2>/dev/null || xdg-open dist/index.html 2>/dev/null

# Re-extract clean modular files from pristine index.html
split:
    node scripts/split-all.js

# Clean temporary build artifacts and caches
clean:
    rm -rf dist/ .vite/
    @echo "✅ Cleaned build artifacts!"
