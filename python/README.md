# Inhumate RTI Client for Python

Please refer to the [Inhumate RTI documentation](https://gitlab.com/inhumate/rti/-/wikis/home) for more information.

Example usage:

```python
import inhumate_rti as RTI

rti = RTI.Client(application="python_test")

def on_connect():
    print("Connected")

rti.on("connect", on_connect)

def on_error(channel, message, exception):
    print(f"Error: {channel}: {message}", file=sys.stderr)

rti.on("error", on_error)

def on_message(content): 
    print(f"received: {content}")

rti.subscribe_text("test", on_message)

rti.wait_until_connected()

rti.publish_text("test", "foo")
```
