#!/bin/bash -e

[ -z "$UE5" -a -d "/c/Program Files/Epic Games/UE_5.6" ] && export UE5="/c/Program Files/Epic Games/UE_5.6"
[ -z "$UE5" -a -d "/c/UE_5.6" ] && export UE5="/c/UE_5.6"
[ -z "$UE5" -a -d "/d/UE_5.6" ] && export UE5="/d/UE_5.6"
if [ -z "$UE5" ]; then
    echo "Don't know where UE5 is installed. Please set environment variable UE5."
    exit 1
fi

export PATH="/c/Program Files/CMake/bin:$PATH"

cd "$(dirname $0)/.."

scripts/get_dependencies.sh

if [ ! -d protobuf/cmake-ue5-build ]; then
    mkdir protobuf/cmake-ue5-build && cd protobuf/cmake-ue5-build
    cmake -A x64 -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_MSVC_STATIC_RUNTIME=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 ../cmake
    cmake --build . --config Release
    cd -
fi

rm -rf build-ue5
mkdir build-ue5 && cd build-ue5
PATH="$PWD/../protobuf/cmake-ue5-build/Release:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf/cmake-ue5-build cmake -A x64 ..
cmake --build . --config Release

mkdir -p Include Win64
cp ../protobuf/cmake-ue5-build/Release/*.lib Win64/
cp ../protobuf/cmake-ue5-build/Release/protoc.exe Win64/
cp -rf ../protobuf/src/google Include/
find Include/google -name '*.cc' -delete
cp ../inhumaterti.hpp *.pb.h Include/
cp Release/*.lib Win64/
