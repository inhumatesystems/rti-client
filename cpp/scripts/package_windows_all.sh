#!/bin/bash -e

[ -z "$VERSION" ] && VERSION=$CI_COMMIT_TAG
[ -z "$VERSION" -a ! -z "$CI_PIPELINE_IID" ] && VERSION=0.0.$CI_PIPELINE_IID
if [ -z "$VERSION" ]; then
    echo "Please set the VERSION environment variable when manually building a release."
    exit 1
fi

FILENAME=inhumate-rti-cpp-client-windows-all-$VERSION.zip

cd "$(dirname $0)/.."

if [ ! -d build-all ]; then
    scripts/windows_build_all.sh
fi

mkdir -p build-all/include/inhumaterti
cp inhumaterti.hpp build-all/include/inhumaterti/
sed -i "s/0.0.1-dev-version/${VERSION}/g" build-all/include/inhumaterti/inhumaterti.hpp
cp build-static-x64-release/*.pb.h build-all/include/inhumaterti/

cp -rf protobuf/src/google build-all/include/
find build-all/include/google -name '*.cc' -delete

cd build-all
/c/Program\ Files/7-zip/7z a -tzip ../$FILENAME *
ls -lh ../$FILENAME
