#!/bin/bash
# Deploy coreader site to GitHub Pages
# Usage: bash deploy.sh

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "=== Coreader Deploy Script ==="
echo "Building site..."
node src/build/cli.js site

echo "Switching to gh-pages branch..."
git checkout gh-pages

echo "Cleaning gh-pages root..."
git rm -rf . 2>/dev/null || true

echo "Copying site files to root..."
# Only copy files from site/ to root (not node_modules)
for f in site/*.html site/*.js site/*.json; do
    [ -f "$f" ] && cp "$f" .
done
cp -r site/assets ./assets
cp -r site/books ./books

echo "Committing..."
git add -A
git commit -m "deploy: site built $(date +%Y-%m-%d %H:%M)" || echo "No changes to commit"

echo "Pushing gh-pages..."
git push origin gh-pages

echo "Switching back to main..."
git checkout main

echo "Done! Site deployed to https://pooyankr-boop.github.io/coreader/"
