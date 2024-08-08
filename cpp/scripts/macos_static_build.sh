#!/bin/bash -e


#for package in gcc g++ make cmake libssl-dev; do
# brew install openssl


cd "$(dirname $0)/.."

scripts/get_dependencies.sh

if [ ! -d protobuf/cmake-build ]; then
    mkdir protobuf/cmake-build && cd protobuf/cmake-build
    cmake -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_WITH_ZLIB=OFF -DCMAKE_CXX_FLAGS="-fPIC" ../cmake
    make
    cd -
fi

rm -rf build
mkdir build && cd build
PATH="$PWD/../protobuf/cmake-build:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf/cmake-build cmake -DBUILD_SHARED=OFF ..
make $*
