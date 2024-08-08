#!/usr/bin/env -S python -i

import os
import sys

sys.path.append(os.path.dirname(__file__))
import inhumate_rti_client as RTI

rti = RTI.Client("python shell")

def on_error(channel, error):
    print(f"error: {channel}: {error}")
rti.on("error", on_error)

def on_connect():
    print("connected")
    def on_disconnect():
        print("disconnected")
    rti.on("disconnect", on_disconnect)
rti.on("connect", on_connect)

if not rti.wait_until_connected(): 
    print("not connected")
