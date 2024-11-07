#!/bin/bash -e

[ -z "$VERSION" ] && VERSION=$CI_COMMIT_TAG
[ -z "$VERSION" -a ! -z "$CI_PIPELINE_IID" ] && VERSION=0.0.$CI_PIPELINE_IID
if [ -z "$VERSION" ]; then
    echo "Please set the VERSION environment variable when manually building a release."
    exit 1
fi

FILENAME=inhumate-rti-ue5-cpp-client-$VERSION.zip

cd "$(dirname $0)/../build-ue5"

# Some "pre-packaging" has been done in *_ue5_build.sh

zip -r $FILENAME Include Win64 # Linux # Mac 
ls -lh $FILENAME
