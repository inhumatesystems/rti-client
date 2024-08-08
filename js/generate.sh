#!/bin/bash
cd "$(dirname $0)"
rm -rf src/generated/*
mkdir -p src/generated

# We need the Typescript plugin for protoc
TS_PROTO_PATH="node_modules/.bin/protoc-gen-ts_proto"
[ -e "$TS_PROTO_PATH" ] || npm install
[ -e "$TS_PROTO_PATH.cmd" ] && TS_PROTO_PATH='node_modules\.bin\protoc-gen-ts_proto.cmd'

# Directory to write generated code to (.js and .d.ts files) 
OUT_DIR="./src/generated"
 
protoc=protoc
if [ -e "../protobuf/bin/protoc" ]; then
    protoc="../protobuf/bin/protoc"
fi
echo "Using $protoc and $TS_PROTO_PATH"

$protoc \
    --plugin="protoc-gen-ts_proto=${TS_PROTO_PATH}" \
    --ts_proto_out="${OUT_DIR}" \
    --ts_proto_opt=esModuleInterop=true \
    --ts_proto_opt=importSuffix=.js \
    --proto_path=../proto \
    ../proto/*.proto
