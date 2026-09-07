#!/bin/bash -e

# libc++-13-dev libc++abi-13-dev clang
for package in cmake; do
    dpkg-query -s $package >/dev/null 2>&1 || sudo apt-get install -y $package
done

[ -z "$UE5" -a -d "$HOME/UE_5.8" ] && export UE5="$HOME/UE_5.8"
[ -z "$UE5" -a -d "$HOME/Projects/UE_5.8" ] && export UE5="$HOME/Projects/UE_5.8"
if [ -z "$UE5" ]; then
    echo "Don't know where UE5 is installed. Please set environment variable UE5."
    exit 1
fi

cd "$(dirname $0)/.."

# The bundled clang toolchain is versioned (v23 for UE 5.4, v25 for UE 5.6, ...) - pick whatever
# this engine ships rather than hardcoding it.
TOOLCHAIN="$(ls -d "$UE5"/Engine/Extras/ThirdPartyNotUE/SDKs/HostLinux/Linux_x64/*/x86_64-unknown-linux-gnu 2>/dev/null | sort | tail -1)"
if [ -z "$TOOLCHAIN" ]; then
    echo "No Linux clang toolchain found under $UE5/Engine/Extras/ThirdPartyNotUE/SDKs/HostLinux/Linux_x64"
    exit 1
fi
export CC="$TOOLCHAIN/bin/clang"
export CXX="$TOOLCHAIN/bin/clang++"

# The toolchain directory is also UE's sysroot (a glibc 2.28 / rockylinux8 tree). Without
# --sysroot, clang finds the *host* glibc headers instead, and a host glibc >= 2.38 redirects
# strtol/strtoll/... to the __isoc23_* symbols. Those don't exist in the sysroot UE links its
# binaries against, so the plugin link fails with
#   ld.lld: error: undefined symbol: __isoc23_strtol
# referenced from libprotobuf.a and libinhumaterti.a. Everything we hand to UE must therefore be
# compiled against the same sysroot UE itself uses.
SYSROOT_FLAGS="-target x86_64-unknown-linux-gnu --sysroot=$TOOLCHAIN"

# UE's own libc++ - the one every engine module is compiled against. See the comment in
# CMakeLists.txt for why -nostdinc++ is required.
#
# Up to UE 5.6 this was shipped separately in Engine/Source/ThirdParty/Unix/LibCxx. As of UE 5.8
# that directory is gone and the engine uses the libc++ bundled with the clang toolchain instead:
# UnrealBuildTool adds $TOOLCHAIN/include/c++/v1 to the include path and links
# $TOOLCHAIN/lib64/libc++.a + libc++abi.a (see LinuxToolChain.cs, ShouldUseLibcxx). Prefer that,
# and fall back to the old location so older engines still build.
if [ -d "$TOOLCHAIN/include/c++/v1" ]; then
    LIBCXX_INCLUDE="$TOOLCHAIN/include/c++/v1"
    LIBCXX_LIB="$TOOLCHAIN/lib64"
else
    LIBCXX="$UE5/Engine/Source/ThirdParty/Unix/LibCxx"
    LIBCXX_INCLUDE="$LIBCXX/include/c++/v1"
    LIBCXX_LIB="$LIBCXX/lib/Unix/x86_64-unknown-linux-gnu"
fi
if [ ! -d "$LIBCXX_INCLUDE" -o ! -f "$LIBCXX_LIB/libc++.a" ]; then
    echo "No UE libc++ found at $LIBCXX_INCLUDE / $LIBCXX_LIB"
    exit 1
fi

scripts/get_dependencies.sh

if [ ! -d protobuf-ue5-build ]; then
    mkdir protobuf-ue5-build && cd protobuf-ue5-build
    cmake -Dprotobuf_BUILD_TESTS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -Dprotobuf_WITH_ZLIB=OFF \
        -DCMAKE_C_FLAGS="-fPIC $SYSROOT_FLAGS" \
        -DCMAKE_CXX_FLAGS="-fPIC $SYSROOT_FLAGS -nostdinc++ -stdlib=libc++ -std=c++11 -I$LIBCXX_INCLUDE -Qunused-arguments" \
        -DCMAKE_EXE_LINKER_FLAGS="$SYSROOT_FLAGS -L$LIBCXX_LIB -nostdlib++" \
        -DCMAKE_SHARED_LINKER_FLAGS="$SYSROOT_FLAGS -L$LIBCXX_LIB -nostdlib++" \
        -DCMAKE_CXX_STANDARD_LIBRARIES="-L$LIBCXX_LIB -lc++ -lc++abi -lm -lpthread -ldl" \
        ../protobuf/cmake
    make -j8
    cd -
fi

rm -rf build-ue5
mkdir build-ue5 && cd build-ue5
PATH="$PWD/../protobuf-ue5-build:$PATH" CMAKE_INCLUDE_PATH=../protobuf/src CMAKE_LIBRARY_PATH=../protobuf-ue5-build cmake \
    -DUE_LIBCXX_INCLUDE="$LIBCXX_INCLUDE" \
    -DUE_LIBCXX_LIB="$LIBCXX_LIB" \
    -DCMAKE_C_FLAGS="$SYSROOT_FLAGS" \
    -DCMAKE_CXX_FLAGS="$SYSROOT_FLAGS" \
    -DCMAKE_EXE_LINKER_FLAGS="$SYSROOT_FLAGS" \
    -DCMAKE_SHARED_LINKER_FLAGS="$SYSROOT_FLAGS" \
    ..
make -j8

mkdir -p Include Linux
cp ../protobuf-ue5-build/*.a Linux/
cp ../protobuf-ue5-build/protoc Linux/
cp -rf ../protobuf/src/google Include/
find Include/google -name '*.cc' -delete
cp ../inhumaterti.hpp ../generated/rticontract.hpp ../generated/*.pb.h Include/
cp *.a Linux/
