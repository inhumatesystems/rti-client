#!/bin/bash -e
cd "$(dirname $0)/.."

git config advice.detachedHead false

# The protobuf C++ source is not fetched here: `npm run generate` puts it in protobuf/ via the
# cpp job's `protobufSource` in inhumate-contract.yml, at the same version that job's protoc is
# pinned to. Those two have to agree - generated C++ carries a hard #error guard against a
# mismatched runtime - so exactly one thing decides the version, and it is that manifest.
#
# NOTE: that version is deliberately old (3.11.2). protobuf 22 and up pull in abseil, which caused
# dependency hell here, see https://github.com/protocolbuffers/protobuf/issues/12292
if [ ! -f protobuf/.inhumate-contract-protobuf ]; then
    echo "error: cpp/protobuf is missing or incomplete." >&2
    echo "       Run 'npm run generate' from the repo root first - it fetches the protobuf" >&2
    echo "       C++ source along with the generated code." >&2
    exit 1
fi

if [ ! -d asio ]; then
    git clone https://github.com/chriskohlhoff/asio.git
    # git clone https://github.com/sailfish009/asio.git
fi
cd asio
# this specific commit is v1.12.2 of asio - later versions don't work with websocketpp
# seems to apply to Unreal build (clang) only though...
git checkout asio-1-12-2 # c74319daf96f8ddd53f015f0b16391e9f6811dbb
# git pull
cd -

if [ ! -d websocketpp ]; then
    git clone https://github.com/zaphoyd/websocketpp.git
else
    cd websocketpp
    git pull
    cd -
fi

# openssl 1.1 on windows only - linux use system package, macos brew
if [ "$(uname -o)" == "Msys" -a ! -d openssl ]; then
    curl -O https://download.firedaemon.com/FireDaemon-OpenSSL/openssl-3.6.2.zip
    mkdir -p openssl
    unzip openssl-3.6.2.zip -d openssl
fi
