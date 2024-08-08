import sys, os
sys.path.insert(0, os.path.dirname(__file__) + "/..")

import inhumate_rti_client as RTI
import time

rti = RTI.Client(application="python_usage_example")

def on_control(message: RTI.proto.RuntimeControl):
    print("Received a control message:", message.load_scenario.name)

rti.subscribe("control", RTI.proto.RuntimeControl, on_control)

def on_text(text: str):
    print(f"Received text: {text}")

rti.subscribe_text("text", on_text)

def on_connect():
    print("Connected")

rti.on("connect", on_connect)

def on_disconnect():
    print("Disconnected")

rti.on("disconnect", on_disconnect)

def on_error(type, message, exception):
    print(f"Error: {type}: {message} {exception}")

rti.on("error", on_error)

try:
    time.sleep(1)
    rti.state = RTI.proto.RuntimeState.RUNNING
    message = RTI.proto.RuntimeControl()
    message.load_scenario.name = "python_test"
    rti.publish("control", message)
    print("Published a control message")
    time.sleep(1)
    input("Press enter or ctrl-c to quit...")
except KeyboardInterrupt:
    pass
rti.disconnect()
