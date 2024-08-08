#!/bin/bash
IFS=$'\n'
cd "$(dirname $0)/.."
for script in $(find . -name generate.sh); do 
    echo $script
    $script
done
