# Inhumate RTI C++ Client

## Dependencies

The C++ client depends on:
- Protobuf
- asio (header-only)
- websocketpp (header-only)
- OpenSSL

## Building

The project uses CMake, but also has a bunch of [shell scripts](scripts/) mainly for dependency management.

There are essentially six platforms to build for:
- Windows, Mac, Linux - using native stuff on the platform
- Unreal Engine variant for each of the above - using clang and the third-party libraries that come with the engine

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
