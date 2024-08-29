# Inhumate RTI C++ Client

This is the C++ client for the Inhumate RTI
(RunTime Infrastructure), part of the [Inhumate Suite](https://inhumatesystems.com/products/suite/).

## Installing

Pre-compiled binaries are available in two flavors:
- Statically linked library for Linux and Windows 64-bit
- UE5-compatible library for Linux and Win64

These can be downloaded from the [Inhumate Downloads](https://get.inhumatesystems.com/) page.

For other cases, build the library from source (see below) and include it in your project.

## Quick Start

```c++
#include "inhumaterti.hpp"

int main() {
    inhumate::rti::RTIClient rti("C++ RTI App", false);
    // ...
    while (!done) {
        rti.Poll();
        // ...
    }
}
```

For a more complete usage example, see [usage_example.cpp](https://github.com/inhumatesystems/rti-client/blob/main/cpp/usage_example.cpp).

## Building from Source

The project uses CMake, but also has a bunch of [shell scripts](scripts/) mainly for dependency management.

There are essentially six platforms to build for:
- Windows, Mac, Linux - using native stuff on the platform
- Unreal Engine variant for each of the above - using clang and the third-party libraries that come with the engine

### Dependencies

The C++ client depends on:
- Protobuf
- asio (header-only)
- websocketpp (header-only)
- OpenSSL
- CMake (as build system)

### Building on Linux

Static/"normal" build:

```sh
sudo apt install gcc g++ make cmake libasio-dev libssl-dev libwebsocketpp-dev
scripts/linux_static_build.sh
```

UE5 build:

```sh
sudo apt install libc++-dev libc++abi-dev clang cmake
export UE5=/path/to/UE5
scripts/linux_ue5_build.sh
```

### Building on Windows

Preqrequisites:
- Visual Studio 2017/2019 with C++ development package
- cmake
- git, git bash

Static build:

OpenSSL can be installed from [here](https://slproweb.com/products/Win32OpenSSL.html) - select the _Win64 OpenSSL v1.1.1d_ (not _Light_) version

```sh
scripts/windows_static_build.sh
```

UE5 build:

```sh
export UE5=/c/path/to/UE5
scripts/windows_ue5_build.sh
```

### Building on macOS

UE5 build is the only relevant one for now...

```sh
# you need XCode and command-line utils installed via App Store etc
brew install cmake
export UE5=/path/to/UE5
scripts/macos_ue5_build.sh
```
