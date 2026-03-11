# momentum.js

## Project Overview

`momentum.js` is an attempt to port the spirit of the [Processing](https://processing.org/) framework (including [p5.js](https://p5js.org/)), [openFrameworks](https://openframeworks.cc/), and [basil.js](https://basiljs2.netlify.app/) to Adobe After Effects. It aims to provide designers and developers with a powerful toolkit for procedural design and automation tasks within a user-friendly [WYSIWYG](https://en.wikipedia.org/wiki/WYSIWYG) interface in After Effects.

## Documentation

Start here if you are new to Momentum:

- [Getting Started](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/getting-started.md)

Browse the full API reference here:

- [API Reference](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/index.md)

If you use AI to write Momentum code, you can give the following docs to the AI so it can understand Momentum syntax, supported APIs, and important limitations:

- [Momentum For AI](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/ai/momentum-for-ai.md)
- [AI Quick Rules](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/ai/ai-quick-rules.md) (short version, suitable for directly copying into an AI prompt)

## Features

- Provides an API that is highly aligned with p5.js.
- Provides users with controller interfaces that make it possible to drive variables with keyframes.
- Seamless integration with After Effects.

## Example Code

![showcase](footage/showcase.png)
Momentum includes an IDE inside After Effects for writing and testing sketches.

```javascript
// Example code: Create a simple rectangle

rect(50, 50, 300, 300);
```

## Contribution

- Contributors are welcome to submit issues, feature requests, and code improvements.
- Please read our contribution guidelines before submitting.