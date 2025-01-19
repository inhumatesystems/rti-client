# Inhumate RTI Vue Integration

Vue 3 integration for the Inhumate RTI
(RunTime Infrastructure), part of the [Inhumate Suite](https://inhumatesystems.com/products/suite/).

See the Inhumate Suite [documentation](https://docs.inhumatesystems.com/) for more in-depth topics and an overview of the software suite.

## Installing

```sh
npm install --save inhumate-rti-vue
```

## Quick Start

In `main.ts`:
```ts
import rti from "inhumate-rti-vue"
app.use(rti, { application: "Vue RTI App" })
```

In a component, if using [pinia](https://pinia.vuejs.org/), use the store to access the RTI client:
```ts
import { useRtiStore } from "inhumate-rti-vue"
const rti = useRtiStore()
rti.client.subscribeText("hello", (msg) => console.log("Received: ", msg))
rti.client.whenConnected(() => rti.client.publishText("hello", "Hello World!"))
```

Or, if not using pinia, the RTI client can be injected:
```ts
import { inject } from "vue"
const rti = inject("rti-client")
rti.subscribeText("hello", (msg) => console.log("Received: ", msg))
rti.whenConnected(() => rti.publishText("hello", "Hello World!"))
```

## Building and running the sandbox app

### Dependencies

- Node (version 20 tested)
- Vue 3
- The [Javascript client](../js/) built

Clone the project from [GitHub](https://github.com/inhumatesystems/rti-client), and in the `vue` folder:

```sh
npm install
npm run build # to build the library
npm start # to run the sandbox app
```

## Feedback & Contributing

Feedback and contributions of any kind are welcome.

- Please file bug reports and/or feature requests as [GitHub issues](https://github.com/inhumatesystems/rti-client/issues)
- Suggest code changes by creating a [pull request](https://github.com/inhumatesystems/rti-client/pulls)
- For any other questions, comments or inquiries, [get in touch](https://inhumatesystems.com/#contact)
