#!/usr/bin/env python3

# A little command-line util to read a directory of protobuf definitions, subscribe to a channel, parse
# and output messages in a somewhat readable format

import os
import sys
import tempfile
import pathlib
import argparse

if __name__ == "__main__":
    sys.path.append(os.path.dirname(__file__) + "/..")
from inhumate_rti import RTIClient

def main():

    parser = argparse.ArgumentParser()
    parser.add_argument("channel", help="Channel to subscribe to")
    parser.add_argument("path", help="Path to .proto files")
    parser.add_argument("type", help="Message type", nargs="?")
    args = parser.parse_args()

    clas = None
    names = []

    # Find .proto files recursively
    protofiles = []
    for path in pathlib.Path(args.path).rglob("*.proto"):
        protofiles.append(str(path))

    if len(protofiles) == 0:
        print(f"No .proto files found in {args.path}")
        sys.exit(1)

    # Run protoc in a temporary directory and import files
    with tempfile.TemporaryDirectory() as tmpdir:
        os.system(f"protoc --python_out={tmpdir} --proto_path={args.path} {' '.join(protofiles)}")
        sys.path.insert(0, tmpdir)
        for file in os.listdir(tmpdir):
            if file.endswith(".py"):
                module_name = file[0:-3]
                module = __import__(module_name)
                for name in module.DESCRIPTOR.message_types_by_name.keys():
                    names.append(name)
                    if name == args.type:
                        clas = getattr(module, args.type)
    if not clas:
        if len(names) == 0:
            print(f"No message types found")
            sys.exit(1)
        elif not args.type:
            print("Try one of the following message types:")
            for name in names: print("  ", name)
            sys.exit(0)
        else:
            print(f"Message type {args.type} not found, try one of {', '.join(names)}")
            sys.exit(1)

    # Connect and subscribe

    rti = RTIClient("protoscribe")

    def on_disconnect():
        print("Disconnected")
    rti.on("disconnect", on_disconnect)

    def on_error(channel, message, exception):
        print(f"Error: {channel}: {message}", file=sys.stderr)
    rti.on("error", on_error)

    rti.subscribe(args.channel, clas, lambda msg: print(msg))

    try:
        input("")
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()

