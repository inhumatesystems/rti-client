#!/bin/bash -e

export PATH="/c/Program Files/CMake/bin:$PATH"

cd "$(dirname $0)/.."
scripts/get_dependencies.sh

if [ ! -d protobuf/cmake-build ]; then
    mkdir protobuf/cmake-build && cd protobuf/cmake-build
    cmake -A x64 -Dprotobuf_BUILD_TESTS=OFF ../cmake
    cmake --build . --config Release
    cd -
fi

rm -rf build
mkdir build && cd build
PATH="$PWD/../protobuf/cmake-build/Release:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf/cmake-build cmake -A x64 -DBUILD_SHARED=OFF ..
cmake --build . --config Release
