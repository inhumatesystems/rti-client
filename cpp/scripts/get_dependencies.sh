#!/bin/bash -e
cd "$(dirname $0)/.."

git config advice.detachedHead false

# NOTE: tried to upgrade to protobuf 23.3, but that caused dependency hell with absl library
# see e.g. https://github.com/protocolbuffers/protobuf/issues/12292
# so for now we stay at an ancient protobuf version that we know works

if [ ! -d protobuf/cmake ]; then
    rm -rf protobuf
    git clone -b v3.11.2 https://github.com/google/protobuf.git
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
