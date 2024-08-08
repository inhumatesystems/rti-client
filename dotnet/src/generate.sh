#!/usr/bin/env sh
cd "$(dirname $0)"
rm -rf generated/*
mkdir -p generated

protoc=protoc
if [ -e "../../protobuf/bin/protoc" ]; then
    protoc="../../protobuf/bin/protoc"
fi
echo "Using $protoc"

$protoc \
    --csharp_out=generated \
    --proto_path=../../proto/ \
    ../../proto/*.proto
