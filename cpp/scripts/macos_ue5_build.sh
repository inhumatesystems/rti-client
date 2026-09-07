#!/bin/bash -e

[ -z "$UE5" -a -d "/Users/Shared/Epic Games/UE_5.8" ] && export UE5="/Users/Shared/Epic Games/UE_5.8"
if [ -z "$UE5" ]; then
    echo "Don't know where UE5 is installed. Please set environment variable UE5."
    exit 1
fi

cd "$(dirname $0)/.."

export CC=clang
export CXX=clang++

# Universal, so the plugin can be built for either architecture - UBT builds Mac editor and game
# targets as arm64+x64 regardless of the host. Deployment target matches CMakeLists.txt and UE's
# own Mac minimum.
export CMAKE_OSX_ARCHITECTURES="arm64;x86_64"

scripts/get_dependencies.sh

# Static, like the Linux and Win64 UE5 builds: BuildPlugin packages nothing but the plugin's own
# binaries, so a .dylib next to them would have to be staged (and code signed) separately, and the
# packaged plugin would fail to load without it.
if [ ! -d protobuf-ue5-build ]; then
    mkdir protobuf-ue5-build && cd protobuf-ue5-build
    cmake -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_WITH_ZLIB=OFF -Dprotobuf_BUILD_SHARED_LIBS=OFF \
        -DCMAKE_CXX_FLAGS="-fPIC" -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
        ../protobuf/cmake
    make -j8
    cd -
fi

rm -rf build-ue5
mkdir build-ue5 && cd build-ue5
PATH="$PWD/../protobuf-ue5-build:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf-ue5-build cmake -DBUILD_SHARED=OFF ..
make -j8

mkdir -p Include Mac
cp ../protobuf-ue5-build/*.a Mac/
cp ../protobuf-ue5-build/protoc Mac/
cp -rf ../protobuf/src/google Include/
find Include/google -name '*.cc' -delete
cp ../inhumaterti.hpp ../generated/rticontract.hpp ../generated/*.pb.h Include/
cp *.a Mac/
