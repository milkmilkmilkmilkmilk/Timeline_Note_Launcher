#!/usr/bin/env bash
# Build script wrapper for Claude Code environment
# This script ensures Node.js is in PATH and runs the build

set -e

# Add Node.js to PATH if not already present
if ! command -v node &> /dev/null; then
    export PATH="$PATH:/c/Program Files/nodejs"
fi

# Verify Node.js is available
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found. Please install Node.js first."
    exit 1
fi

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"
echo ""
echo "Running build..."
npm run build

echo ""
echo "Build completed successfully!"
