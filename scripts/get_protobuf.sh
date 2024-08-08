#!/bin/bash -e

cd "$(dirname $0)/.."

if [ -e protobuf/bin/protoc ]; then
    exit 0
fi

if [ "$(uname -o)" == "Msys" ]; then
    path="v23.3/protoc-23.3-win64.zip"
elif [ "$(uname -o)" == "Darwin" ]; then
    path="v23.3/protoc-23.3-osx-universal_binary.zip"
else
    path="v23.3/protoc-23.3-linux-x86_64.zip"
fi

mkdir -p protobuf
cd protobuf
curl -L "https://github.com/protocolbuffers/protobuf/releases/download/$path" -o protoc.zip
unzip protoc.zip
rm -f protoc.zip
