# Inhumate RTI Client for Python

This is the Python client for the Inhumate RTI
(RunTime Infrastructure), part of the [Inhumate Suite](https://inhumatesystems.com/products/suite/).

See the Inhumate Suite [documentation](https://docs.inhumatesystems.com/) for more in-depth topics and an overview of the software suite.

## Installing

```sh
pip install inhumate-rti
```

## Quick Start

```python
import inhumate_rti as RTI

rti = RTI.Client(application="Python RTI App")
rti.wait_until_connected()

def on_connect():
    print("Connected")
rti.on("connect", on_connect)

def on_hello(content): 
    print(f"Received: {content}")
rti.subscribe_text("hello", on_hello)

rti.publish_text("hello", "Hello World!")
```

Depending on your use case, you might want to avoid threading and use the `main_loop` constructor argument:

```python
import inhumate_rti as RTI

def main_loop():
    print("." if rti.connected else "x", end="", flush=True)
    if rti and rti.connected: rti.publish_text("foo", "bar")

# connect after initializing, otherwise 'rti' will be undefined in the main loop
rti = RTI.Client(application="Python RTI App", connect=False, main_loop=main_loop, main_loop_idle_time=1.0)
rti.connect() # blocks further execution
```

For a more complete usage example, see 
[usage_example.py](https://github.com/inhumatesystems/rti-client/blob/main/python/test/usage_example.py) and 
[usage_example_main_loop.py](https://github.com/inhumatesystems/rti-client/blob/main/python/test/usage_example_main_loop.py).

## Running tests

Clone the project from [GitHub](https://github.com/inhumatesystems/rti-client), and in the `python` folder:

```sh
python -m virtualenv .venv
. .venv/bin/activate
pip install -r inhumate_rti/requirements.txt 
pip install -r test/requirements.txt
pytest
```

## Feedback & Contributing

Feedback and contributions of any kind are welcome.

- Please file bug reports and/or feature requests as [GitHub issues](https://github.com/inhumatesystems/rti-client/issues)
- Suggest code changes by creating a [pull request](https://github.com/inhumatesystems/rti-client/pulls)
- For any other questions, comments or inquiries, [get in touch](https://inhumatesystems.com/#contact)
