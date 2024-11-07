#!/bin/bash -e

# libc++-13-dev libc++abi-13-dev clang
for package in cmake; do
    dpkg-query -s $package >/dev/null 2>&1 || sudo apt-get install -y $package
done

[ -z "$UE5" -a -d "$HOME/UnrealEngine" ] && export UE5="$HOME/UnrealEngine"
[ -z "$UE5" -a -d "$HOME/Projects/UnrealEngine" ] && export UE5="$HOME/Projects/UnrealEngine"
if [ -z "$UE5" ]; then
    echo "Don't know where UE5 is installed. Please set environment variable UE5."
    exit 1
fi

cd "$(dirname $0)/.."

export CC="$UE5/Engine/Extras/ThirdPartyNotUE/SDKs/HostLinux/Linux_x64/v23_clang-18.1.0-rockylinux8/x86_64-unknown-linux-gnu/bin/clang"
export CXX="$UE5/Engine/Extras/ThirdPartyNotUE/SDKs/HostLinux/Linux_x64/v23_clang-18.1.0-rockylinux8/x86_64-unknown-linux-gnu/bin/clang++"

scripts/get_dependencies.sh

if [ ! -d protobuf/cmake-ue5-build ]; then
    mkdir protobuf/cmake-ue5-build && cd protobuf/cmake-ue5-build
    cmake -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_WITH_ZLIB=OFF -DCMAKE_CXX_FLAGS="-fPIC -stdlib=libc++ -std=c++11 -I$UE5/Engine/Source/ThirdParty/Unix/LibCxx/include/c++/v1 -L$UE5/Engine/Source/ThirdParty/Unix/LibCxx/lib/Unix/x86_64-unknown-linux-gnu -Qunused-arguments" ../cmake
    make -j8
    cd -
fi

rm -rf build-ue5
mkdir build-ue5 && cd build-ue5
PATH="$PWD/../protobuf/cmake-ue5-build:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf/cmake-ue5-build cmake ..
make -j8

mkdir -p Include Linux
cp ../protobuf/cmake-ue5-build/*.a Linux/
cp ../protobuf/cmake-ue5-build/protoc Linux/
cp -rf ../protobuf/src/google Include/
find Include/google -name '*.cc' -delete
cp ../inhumaterti.hpp *.pb.h Include/
cp *.a Linux/
