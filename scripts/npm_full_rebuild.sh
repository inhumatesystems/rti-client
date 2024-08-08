#!/bin/bash -e

cd "$(dirname $0)/.."

find . -name node_modules -exec rm -rf {} \; || echo whatevs
find . -name package-lock.json -delete
# npm install

cd js ; npm install ; npm run build
cd ../vue ; npm install ; npm run build
