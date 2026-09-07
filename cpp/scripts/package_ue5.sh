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

# Which platform directories are here depends on which build jobs fed this one their artifacts,
# so package whichever ones are actually present rather than a fixed list.
PLATFORMS=""
for dir in Win64 Linux Mac; do
    [ -d "$dir" ] && PLATFORMS="$PLATFORMS $dir"
done
if [ -z "$PLATFORMS" ]; then
    echo "No platform directories (Win64, Linux, Mac) in $PWD - did the ue5 build jobs run?"
    exit 1
fi

zip -r $FILENAME Include $PLATFORMS
ls -lh $FILENAME
