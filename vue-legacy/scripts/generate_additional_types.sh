#!/bin/bash

cd "$(dirname $0)/.."
node_modules/.bin/tsc --declaration src/components/subscribingcomponent.ts src/constants.ts src/formatting.ts --emitDeclarationOnly --outDir types
