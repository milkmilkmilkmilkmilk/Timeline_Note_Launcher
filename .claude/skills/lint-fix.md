# lint-fix

Run ESLint with automatic fixes for common issues (unused imports, formatting).

## Usage

/lint-fix

## What it does

1. Runs `npm run lint -- --fix` via the npm.sh wrapper
2. Shows which files were modified
3. Reports any remaining errors that require manual fixes

## When to use

- After refactoring to remove unused imports
- Before committing to auto-fix formatting issues
- When lint errors are reported in pre-commit hook

## Implementation

```bash
#!/usr/bin/env bash
set -e

echo "Running ESLint with auto-fix..."
./npm.sh run lint -- --fix

echo ""
echo "Auto-fix complete. Checking for remaining issues..."
./npm.sh run lint
```
