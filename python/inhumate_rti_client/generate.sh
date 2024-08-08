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
    --python_out=generated \
    --proto_path=../../proto/ \
    ../../proto/*.proto

# https://github.com/protocolbuffers/protobuf/issues/1491
SED=gsed
which gsed >/dev/null 2>&1 || SED=sed
$SED -i -E 's/^import.*_pb2/from . \0/' generated/*.py
