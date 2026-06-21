#!/bin/bash
set -e

echo "Installing pnpm..."
npm install -g pnpm

echo "Installing dependencies..."
pnpm install

echo "Building project..."
pnpm build

echo "Build complete!"
ls -la dist/
