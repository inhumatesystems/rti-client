# Inhumate RTI Client for Python

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

For a more complete usage example, see [usage_example.py](test/usage_example.py) and [usage_example_main_loop.py](test/usage_example_main_loop.py).

## Running tests

```sh
python -m virtualenv .venv
. .venv/bin/activate
pip install -r inhumate_rti/requirements.txt 
pip install -r test/requirements.txt
pytest
```
