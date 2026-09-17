#!/bin/bash
# Deploy script for coreader
# Usage: bash deploy.sh

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

echo "Building site..."
node src/build/cli.js site

echo "Switching to gh-pages..."
git checkout gh-pages

echo "Cleaning old gh-pages content..."
git rm -rf . 2>/dev/null || true

echo "Copying site to gh-pages root..."
cp -r site/* .
cp site/.* . 2>/dev/null || true

echo "Committing..."
git add -A
git commit -m "chore: deploy site $(date +%Y-%m-%d\ %H:%M)"

echo "Pushing gh-pages..."
git push origin gh-pages

echo "Switching back to main..."
git checkout main

echo "Done!"
