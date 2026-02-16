# check-types

Run TypeScript type-check only (fast feedback, no build output).

## Usage

/check-types

## What it does

Runs `tsc -noEmit -skipLibCheck` to validate TypeScript types without generating output files.

## When to use

- During active development for fast type feedback
- After changing type definitions in types.ts
- When you want to check types without waiting for full build

## Implementation

```bash
#!/usr/bin/env bash
set -e

# Add Node.js to PATH if not present
if ! command -v node &> /dev/null; then
    export PATH="$PATH:/c/Program Files/nodejs"
fi

echo "Running TypeScript type-check..."
npx tsc -noEmit -skipLibCheck

echo ""
echo "✓ Type check passed"
```
