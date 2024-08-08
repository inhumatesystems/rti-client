#!/bin/bash
cd "$(dirname $0)"
rm -rf src/generated/*
mkdir -p src/generated

export PATH=$PATH:"$PWD/../node_modules/.bin"

# We need the Typescript plugin for protoc
PROTOC_GEN_TS_PATH="../node_modules/.bin/protoc-gen-ts"
[ -e "$PROTOC_GEN_TS_PATH" ] || npm install
[ -e "$PROTOC_GEN_TS_PATH.cmd" ] && PROTOC_GEN_TS_PATH='..\node_modules\.bin\protoc-gen-ts_proto.cmd'

# Directory to write generated code to (.js and .d.ts files) 
OUT_DIR="./src/generated"
 
protoc=protoc
if [ -e "../protobuf/bin/protoc" ]; then
    protoc="../protobuf/bin/protoc"
fi
echo "Using $protoc and $PROTOC_GEN_TS_PATH"

$protoc \
    --plugin="protoc-gen-ts=${PROTOC_GEN_TS_PATH}" \
    --js_out="import_style=commonjs,binary:${OUT_DIR}" \
    --ts_out="${OUT_DIR}" \
    --proto_path=../proto \
    ../proto/*.proto
