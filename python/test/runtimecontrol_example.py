import sys, os
sys.path.insert(0, os.path.dirname(__file__) + "/..")

import inhumate_rti as RTI
import time

sim_time = 0.0

def update(dt):
    print(f"Update: {sim_time} {dt}")
    # do simulation work
    time.sleep(0.1)

last_real_time = time.time()

def main_loop():
    global sim_time
    global last_real_time

    if rti.state == RTI.proto.RuntimeState.RUNNING:
        real_time = time.time()
        dt = real_time - last_real_time
        last_real_time = real_time
        sim_time += dt * (runtime.time_scale or 1.0)
        update(dt)
    else:
        time.sleep(0.1) # idle

rti = RTI.Client(application="python_usage_example", main_loop=main_loop)
runtime = RTI.RuntimeControl(rti)

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


try:
    rti.connect() # now blocking with main loop

except KeyboardInterrupt:
    pass
rti.disconnect()
