# build-validate

Run full CI validation locally (TypeScript type-check + build + lint).

## Usage

/build-validate

## What it does

Runs the exact same checks as CI workflow (.github/workflows/lint.yml):
1. `npm run build` - TypeScript type-check (tsc -noEmit) + esbuild production build
2. `npm run lint` - ESLint validation

## When to use

- Before pushing commits (ensure CI will pass)
- After major refactoring
- When you want confidence that the build is clean

## Implementation

```bash
#!/usr/bin/env bash
set -e

echo "Running full CI validation..."
echo ""

echo "Step 1/2: Building..."
./build.sh

echo ""
echo "Step 2/2: Linting..."
./npm.sh run lint

echo ""
echo "✓ All CI checks passed!"
```
