#!/bin/bash -e

# Linux static build uses as much as possible from the official apt repository, 
# i.e. evertyhing but protobuf. This mainly to support some applicationes like X-Plane.

#for package in gcc g++ make cmake libssl-dev; do
for package in gcc g++ make cmake libasio-dev libssl-dev libwebsocketpp-dev; do
    dpkg-query -s $package >/dev/null 2>&1 || sudo apt-get install -y $package
done

cd "$(dirname $0)/.."

# scripts/get_dependencies.sh
if [ ! -d protobuf ]; then
    git clone -b v3.11.2 https://github.com/google/protobuf.git
fi

if [ ! -d protobuf/cmake-build ]; then
    mkdir protobuf/cmake-build && cd protobuf/cmake-build
    cmake -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_WITH_ZLIB=OFF -DCMAKE_CXX_FLAGS="-fPIC" ../cmake
    make
    cd -
fi

rm -rf build
mkdir build && cd build
PATH="$PWD/../protobuf/cmake-build:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf/cmake-build cmake -DBUILD_SHARED=OFF ..
make
