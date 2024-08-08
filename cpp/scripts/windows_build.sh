#!/bin/bash -e

export PATH="/c/Program Files/CMake/bin:$PATH"

cd "$(dirname $0)/.."

stada=$1
arch=$2
config=$3

if [ -z "$stada" -o -z "$arch" -o -z "$config" ]; then
    echo "usage: windows_build.sh <static|dynamic> <win32|x64> <debug|release>"
    exit 1
fi

variant="$stada-$arch-$config"

scripts/get_dependencies.sh

[ "$stada" == "static" ] && shared=OFF || shared=ON

if [ ! -d protobuf/cmake-build-$variant ]; then
    mkdir protobuf/cmake-build-$variant && cd protobuf/cmake-build-$variant
    cmake -A $arch -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_BUILD_SHARED_LIBS=$shared ../cmake
    cmake --build . --config $config
    cd -
fi

rm -rf build-$variant
mkdir build-$variant && cd build-$variant
PATH="$PWD/../protobuf/cmake-build-$variant/$config:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf/cmake-build-$variant \
    cmake -A $arch -DBUILD_SHARED=$shared -DPROTOBUF_BUILD_DIR="$PWD/../protobuf/cmake-build-$variant/$config" ..
cmake --build . --config $config
