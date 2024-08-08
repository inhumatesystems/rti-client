#!/bin/bash -e

[ -z "$UE5" -a -d "/Users/Shared/Epic Games/UE_5.3" ] && export UE5="/Users/Shared/Epic Games/UE_5.3"
if [ -z "$UE5" ]; then
    echo "Don't know where UE5 is installed. Please set environment variable UE5."
    exit 1
fi

cd "$(dirname $0)/.."

export CC=clang
export CXX=clang++

scripts/get_dependencies.sh

if [ ! -d protobuf/cmake-ue5-build ]; then
    mkdir protobuf/cmake-ue5-build && cd protobuf/cmake-ue5-build
    CMAKE_OSX_ARCHITECTURES="arm64;x86_64" cmake -Dprotobuf_BUILD_TESTS=OFF  -Dprotobuf_WITH_ZLIB=OFF -Dprotobuf_BUILD_SHARED_LIBS=ON -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 ../cmake
    make
    cd -
fi

rm -rf build-ue5
mkdir build-ue5 && cd build-ue5
CMAKE_OSX_ARCHITECTURES="arm64;x86_64" PATH="$PWD/../protobuf/cmake-ue5-build:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf/cmake-ue5-build cmake ..
make

mkdir -p Include Mac
cp ../protobuf/cmake-ue5-build/*.dylib Mac/
cp ../protobuf/cmake-ue5-build/protoc Mac/
install_name_tool -add_rpath @executable_path/ Mac/protoc
cp -rf ../protobuf/src/google Include/
find Include/google -name '*.cc' -delete
cp ../inhumaterti.hpp *.pb.h Include/
cp *.dylib Mac/
