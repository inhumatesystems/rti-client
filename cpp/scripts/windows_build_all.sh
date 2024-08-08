#!/bin/bash -e

cd "$(dirname $0)/.."
rm -rf build-all

for stada in static dynamic; do
    for arch in win32 x64; do
        for config in debug release; do
            variant="$stada-$arch-$config"
            echo $variant

            ./scripts/windows_build.sh $stada $arch $config

            mkdir -p build-all/$variant
            cp -f build-$variant/$config/*.{exe,lib} build-all/$variant/
            cp -f protobuf/cmake-build-$variant/$config/*.{exe,lib} build-all/$variant/
            if [ "$stada" == "dynamic" ]; then
                cp -f build-$variant/$config/*.dll build-all/$variant/
                cp -f protobuf/cmake-build-$variant/$config/*.dll build-all/$variant/
            fi
            if [ "$config" == "debug" ]; then
                cp -f build-$variant/$config/*.pdb build-all/$variant/
            fi
            rm -f build-all/$variant/libprotobuf-lite* build-all/$variant/libprotoc*.lib build-all/$variant/inhumaterti_test* build-all/$variant/usage_example.pdb
        done
    done
done
