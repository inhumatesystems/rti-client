# Inhumate RTI Javascript Client

This is the Javascript/TypeScript/Web client for the Inhumate RTI
(RunTime Infrastructure), part of the [Inhumate Suite](https://inhumatesystems.com/products/sboss/)
for simulation-based operations.

## Installing

### Using a package manager

Such as NPM:

```
npm install --save inhumate-rti
```

### Using a bundled script file

Download the `inhumate-rti-bundle-*.js` file from the [latest release](https://gitlab.com/inhumate/rti-client/-/releases/permalink/latest) page.

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

Using Node (version 20 tested):

```sh
npm install
npm run build
npm test # with the broker running
npm start # for a usage example
```

## Using it
