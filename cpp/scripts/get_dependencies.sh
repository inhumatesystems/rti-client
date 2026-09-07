#!/bin/bash -e
cd "$(dirname $0)/.."

git config advice.detachedHead false

# The protobuf C++ source is not fetched here: `npm run generate` puts it in protobuf/ via the
# cpp job's `protobufSource` in inhumate-contract.yml, at the same version that job's protoc is
# pinned to. Those two have to agree - generated C++ carries a hard #error guard against a
# mismatched runtime - so exactly one thing decides the version, and it is that manifest.
#
# NOTE: that version is deliberately old (3.11.2). protobuf 22 and up pull in abseil, which caused
# dependency hell here, see https://github.com/protocolbuffers/protobuf/issues/12292
if [ ! -f protobuf/.inhumate-contract-protobuf ]; then
    echo "error: cpp/protobuf is missing or incomplete." >&2
    echo "       Run 'npm run generate' from the repo root first - it fetches the protobuf" >&2
    echo "       C++ source along with the generated code." >&2
    exit 1
fi

if [ ! -d asio ]; then
    git clone https://github.com/chriskohlhoff/asio.git
    # git clone https://github.com/sailfish009/asio.git
fi
cd asio
# this specific commit is v1.12.2 of asio - later versions don't work with websocketpp
# seems to apply to Unreal build (clang) only though...
git checkout asio-1-12-2 # c74319daf96f8ddd53f015f0b16391e9f6811dbb
# git pull

# asio is header-only, so all of it is compiled into libinhumaterti.a and, from there, into
# whatever binary links it. Under clang, asio 1.12.2 wraps every header in
# `#pragma GCC visibility push (default)`, which overrides -fvisibility=hidden and exports the lot.
# On Linux that is a real problem: UE 5.8 ships its own asio in libUnrealEditor-Asio.so, and the
# dynamic linker binds our calls to its definitions - two incompatible asio builds sharing objects,
# which segfaults the moment a connection is opened. Later asio versions guard the pragma with
# ASIO_DISABLE_VISIBILITY; 1.12.2 does not, so add the guard here. The checkout above restores the
# pristine headers first, which keeps this idempotent.
for file in push_options pop_options; do
    path="asio/include/asio/detail/$file.hpp"
    sed -i \
        -e 's|^#  pragma GCC visibility push (default)$|#  if !defined(ASIO_DISABLE_VISIBILITY)\n#   pragma GCC visibility push (default)\n#  endif // !defined(ASIO_DISABLE_VISIBILITY)|' \
        -e 's|^#  pragma GCC visibility pop$|#  if !defined(ASIO_DISABLE_VISIBILITY)\n#   pragma GCC visibility pop\n#  endif // !defined(ASIO_DISABLE_VISIBILITY)|' \
        "$path"
    grep -q "ASIO_DISABLE_VISIBILITY" "$path" || { echo "failed to patch $path"; exit 1; }
done
cd -

if [ ! -d websocketpp ]; then
    git clone https://github.com/zaphoyd/websocketpp.git
else
    cd websocketpp
    git pull
    cd -
fi

# openssl 1.1 on windows only - linux use system package, macos brew
if [ "$(uname -o)" == "Msys" -a ! -d openssl ]; then
    curl -O https://download.firedaemon.com/FireDaemon-OpenSSL/openssl-3.6.2.zip
    mkdir -p openssl
    unzip openssl-3.6.2.zip -d openssl
fi
