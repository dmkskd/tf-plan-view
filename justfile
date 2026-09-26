# Justfile for tf plan view
# Run `just` or `just --list` to see available commands

set shell := ["bash", "-cu"]

# Default recipe: list available commands
default:
    @just --list

# Start Vite development server with hot module replacement (HMR)
dev port="3000":
    npx vite src --port {{port}}

# Build the single self-contained HTML asset (index.html & dist/index.html)
build:
    node scripts/build-single-html.js

# Run the entire test suite and regression baselines
test: test-unit test-boot test-render test-pure test-parse test-layout
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

# Validate JavaScript syntax across all source, script, and test files
check:
    @echo "Checking JS syntax across modules..."
    @for f in `find src/js scripts tools -name "*.js"`; do node --check "$f" || exit 1; done
    @echo "✅ All JavaScript files passed syntax verification!"

# Open the self-contained app directly in the default browser
open:
    @open index.html 2>/dev/null || xdg-open index.html 2>/dev/null

# Re-extract clean modular files from pristine index.html
split:
    node scripts/split-all.js

# Clean temporary build artifacts and caches
clean:
    rm -rf dist/ .vite/
    @echo "✅ Cleaned build artifacts!"
