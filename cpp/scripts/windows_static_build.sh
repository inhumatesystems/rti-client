#!/bin/bash -e

export PATH="/c/Program Files/CMake/bin:$PATH"

cd "$(dirname $0)/.."
scripts/get_dependencies.sh

if [ ! -d protobuf-build ]; then
    mkdir protobuf-build && cd protobuf-build
    cmake -A x64 -Dprotobuf_BUILD_TESTS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 ../protobuf/cmake
    cmake --build . --config Release
    cd -
fi

rm -rf build
mkdir build && cd build
PATH="$PWD/../protobuf-build/Release:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf-build cmake -A x64 -DBUILD_SHARED=OFF ..
cmake --build . --config Release
