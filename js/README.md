# Inhumate RTI Javascript Client

This is the Javascript/TypeScript/Web client for the Inhumate RTI
(RunTime Infrastructure), part of the [Inhumate Suite](https://inhumatesystems.com/products/suite/).

## Installing

### Using a package manager

Such as NPM:

```
npm install --save inhumate-rti
```

### Using a bundled script file

Download the *RTI Client JS Bundle* from the [Inhumate Downloads](https://get.inhumatesystems.com/) site.

Then include it in a `script` tag in your HTML file:

```html
<script src="inhumate-rti-bundle-x.x.xx.js"></script>
```

## Quick Start

```ts
const rti = new RTI.Client({ application: "JS RTI App" })
rti.on("connect", () => console.log("RTI connected"))
rti.subscribeText("hello", (channel, message) => console.log(`Received: ${message}`))
rti.whenConnected(() => rti.publishText("hello", "Hello World!"))
```

For a more complete usage example, see [usage_example.ts](https://github.com/inhumatesystems/rti-client/blob/main/js/test/usage_example.ts).

## Building and running tests

Clone the project from [GitHub](https://github.com/inhumatesystems/rti-client), and in the `js` folder, using Node (version 20 tested):

```sh
npm install
npm run build
npm test # with the broker running
npm start # for a usage example
```

## Feedback & Contributing

Feedback and contributions of any kind are welcome.

- Please file bug reports and/or feature requests as [GitHub issues](https://github.com/inhumatesystems/rti-client/issues)
- Suggest code changes by creating a [pull request](https://github.com/inhumatesystems/rti-client/pulls)
- For any other questions, comments or inquiries, [get in touch](https://inhumatesystems.com/#contact)
