#!/bin/bash -e


#for package in gcc g++ make cmake libssl-dev; do
# brew install openssl


cd "$(dirname $0)/.."

scripts/get_dependencies.sh

if [ ! -d protobuf-build ]; then
    mkdir protobuf-build && cd protobuf-build
    cmake -Dprotobuf_BUILD_TESTS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -Dprotobuf_WITH_ZLIB=OFF -DCMAKE_CXX_FLAGS="-fPIC" ../protobuf/cmake
    make
    cd -
fi

rm -rf build
mkdir build && cd build
PATH="$PWD/../protobuf-build:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf-build cmake -DBUILD_SHARED=OFF ..
make $*
