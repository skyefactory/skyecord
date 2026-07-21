#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="/home/skye/skyecord"

cd "$PROJECT_DIR"

# Ensure we are on master
git checkout master

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

echo "Current version: $CURRENT_VERSION"

# Split version and increment patch number
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

NEW_PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"

echo "New version: $NEW_VERSION"

# Update package.json without npm version
node <<EOF
const fs = require("fs");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
pkg.version = "$NEW_VERSION";

fs.writeFileSync(
  "package.json",
  JSON.stringify(pkg, null, 2) + "\n"
);
EOF

CLIENT_FILE="client/index.html"

if [[ -f "$CLIENT_FILE" ]]; then
    echo "Updating client version display..."

    sed -i -E "s/version [0-9]+\.[0-9]+\.[0-9]+/version $NEW_VERSION/g" "$CLIENT_FILE"

    echo "Updated $CLIENT_FILE:"
    grep "version" "$CLIENT_FILE"
else
    echo "Warning: $CLIENT_FILE not found, skipping client version update"
fi

# Verify change
git diff package.json

# Create commit
git add -A
git commit -m "v$NEW_VERSION"

# Create tag
git tag "v$NEW_VERSION"

# Push branch and tag
git push origin master "v$NEW_VERSION"

echo "Released v$NEW_VERSION successfully!"