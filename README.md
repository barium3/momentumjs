# momentum.js

## Project Overview

`momentum.js` is an attempt to port the spirit of the [Processing](https://processing.org/) framework (including [p5.js](https://p5js.org/)), [openFrameworks](https://openframeworks.cc/), and [basil.js](https://basiljs2.netlify.app/) to Adobe After Effects. It aims to provide designers and developers with a powerful toolkit for procedural design and automation tasks within a user-friendly [WYSIWYG](https://en.wikipedia.org/wiki/WYSIWYG) interface in After Effects.

## Documentation

Start here if you are new to Momentum:

- [Getting Started](docs/getting-started.md)

Browse the full API reference here:

- [API Reference](docs/api/index.md)

If you use AI to write Momentum code, you can give the following docs to the AI so it can understand Momentum syntax, supported APIs, and important limitations:

- [Momentum For AI](docs/ai/momentum-for-ai.md)
- [AI Quick Rules](docs/ai/ai-quick-rules.md) (short version, suitable for directly copying into an AI prompt)

## Features

- Provides an API that is highly aligned with p5.js.
- Provides users with controller interfaces that make it possible to drive variables with keyframes.
- Seamless integration with After Effects.

## Example Code

![showcase](footage/showcase.png)
Momentum includes an IDE inside After Effects for writing and testing sketches.

<details>
<summary>Example Code</summary>

```javascript
// Example code: Casey reas Structure 3

var numCircle = 5;
var circles = [];

function setup() {
  createCanvas(200, 200);
  frameRate(30);
  for (var i = 0; i < numCircle; i++) {
    var x = random(width);
    var y = random(height);
    var r = random(20, 60);
    var xspeed = random(-0.25, 0.25);
    var yspeed = random(-0.25, 0.25);
    circles[i] = new Circle(x, y, r, xspeed, yspeed, i);
  }
  background(255);
}

function draw() {
  for (var i = 0; i < 5; i++) {
    circles[i].update();
  }
  for (var j = 0; j < 5; j++) {
    circles[j].move();
  }
}

function Circle(px, py, pr, psp, pysp, pid) {
  this.x = px;
  this.y = py;
  this.r = pr;
  this.r2 = this.r * this.r;
  this.sp = psp;
  this.ysp = pysp;
  this.id = pid;

  this.update = function() {
    for (var i = this.id + 1; i < numCircle; i++) {
      intersect(circles[this.id], circles[i]);
    }
  }

  this.makePoint = function() {
    stroke(0);
    point(this.x, this.y);
  }

  this.move = function() {
    this.x += this.sp;
    this.y += this.ysp;
    if (this.sp > 0) {
      if (this.x > width + this.r) {
        this.x = -this.r;
      }
    } else {
      if (this.x < -this.r) {
        this.x = width + this.r;
      }
    }
    if (this.ysp > 0) {
      if (this.y > height + this.r) {
        this.y = -this.r;
      }
    } else {
      if (this.y < -this.r) {
        this.y = height + this.r;
      }
    }
  }
}

function intersect(cA, cB) {

  var dx = cA.x - cB.x;
  var dy = cA.y - cB.y;
  var d2 = dx * dx + dy * dy;
  var d = sqrt(d2);

  if ((d > cA.r + cB.r) || (d < abs(cA.r - cB.r))) {
    return;
  }

  var a = (cA.r2 - cB.r2 + d2) / (2 * d);
  var h = sqrt(cA.r2 - a * a);
  var x2 = cA.x + a * (cB.x - cA.x) / d;
  var y2 = cA.y + a * (cB.y - cA.y) / d;

  var paX = x2 + h * (cB.y - cA.y) / d;
  var paY = y2 - h * (cB.x - cA.x) / d;
  var pbX = x2 - h * (cB.y - cA.y) / d;
  var pbY = y2 + h * (cB.x - cA.x) / d;

  stroke(dist(paX, paY, pbX, pbY)*4, 12); 
  line(paX, paY, pbX, pbY);

}
```

</details>

## Contribution

- Contributors are welcome to submit issues, feature requests, and code improvements.
- Please read our contribution guidelines before submitting.
