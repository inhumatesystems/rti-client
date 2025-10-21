import sys, os
sys.path.insert(0, os.path.dirname(__file__) + "/..")

import inhumate_rti as RTI

def main_loop():
    print("." if rti.connected else "x", end="", flush=True)
    if rti.connected: rti.publish_text("foo", "bar")

rti = RTI.Client(application="python_usage_example", main_loop=main_loop, main_loop_idle_time=1.0)
runtime = RTI.RuntimeControl(rti)

def on_control(message: RTI.proto.RuntimeControl):
    print("Received a control message:", message.WhichOneof("control"))
rti.subscribe(RTI.channel.control, RTI.proto.RuntimeControl, on_control)

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
    # traceback.print_stack()
rti.on("error", on_error)

def cmd_test(args: dict):
    print("test command", args)
    return (True, "")
RTI.Command("test", cmd_test)
RTI.Command.subscribe(rti)


try:
    rti.state = RTI.proto.RuntimeState.RUNNING
    # message = RTI.proto.RuntimeControl()
    # message.load_scenario.name = "python_test"
    # rti.publish("control", message)
    # print("Published a control message")

    rti.connect() # now blocking with main loop

    print(f"After connect")

except KeyboardInterrupt:
    pass
rti.disconnect()
