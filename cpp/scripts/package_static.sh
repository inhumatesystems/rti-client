#!/bin/bash -e

[ -z "$VERSION" ] && VERSION=$CI_COMMIT_TAG
[ -z "$VERSION" -a ! -z "$CI_PIPELINE_IID" ] && VERSION=0.0.$CI_PIPELINE_IID
if [ -z "$VERSION" ]; then
    echo "Please set the VERSION environment variable when manually building a release."
    exit 1
fi

FILENAME=inhumate-rti-cpp-client-$VERSION.zip

cd "$(dirname $0)/.."

rm -rf build/package
mkdir -p build/package
cd build/package
mkdir inhumaterti protobuf

# Inhumate RTI

cp ../../inhumaterti.hpp inhumaterti/
sed -i "s/0.0.1-dev-version/${VERSION}/g" inhumaterti/inhumaterti.hpp
cp ../*.pb.h inhumaterti/
cp ../libinhumaterti.a inhumaterti/
if [ -d ../Release ]; then
    cp ../Release/inhumaterti.lib inhumaterti/
fi

# Protobuf

cp -rf ../../protobuf/src/google protobuf/
find protobuf/google -name '*.cc' -delete
cp ../../protobuf/cmake-build/*.a protobuf/
cp ../../protobuf/cmake-build/protoc protobuf/
if [ -d ../../protobuf/cmake-build/Release ]; then
    cp ../../protobuf/cmake-build/Release/*.lib protobuf/
    cp ../../protobuf/cmake-build/Release/*.exe protobuf/
fi

zip -r ../$FILENAME *
ls -lh ../$FILENAME
