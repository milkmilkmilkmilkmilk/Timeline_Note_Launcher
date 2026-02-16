#!/usr/bin/env bash
# npm wrapper script for Claude Code environment
# Usage: ./npm.sh <npm commands>

# Add Node.js to PATH if not already present
if ! command -v node &> /dev/null; then
    export PATH="$PATH:/c/Program Files/nodejs"
fi

# Verify Node.js is available
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found. Please install Node.js first."
    exit 1
fi

# Run npm with all arguments
npm "$@"
