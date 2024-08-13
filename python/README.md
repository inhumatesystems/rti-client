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
