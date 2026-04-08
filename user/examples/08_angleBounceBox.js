// createAngle(degrees) creates an angle controller in After Effects.
// Read its value with angle.value(), which returns degrees.
// You can keyframe the angle controller in AE to animate the box rotation over time.

let ballPos;
let ballVel;
let rotateCtrl;

function setup() {
  createCanvas(300, 300);
  rectMode(CENTER);
  ellipseMode(CENTER);

  ballPos = { x: width * 0.5 + 26, y: height * 0.5 - 82 };
  ballVel = { x: 2.6, y: 1.2 };
  rotateCtrl = createAngle(45);
}

function draw() {
  var boxX = width * 0.5;
  var boxY = height * 0.5;
  var boxSize = 150;
  var ballR = 30;
  var angle = radians(rotateCtrl.value());
  var halfSize = boxSize * 0.5 - ballR;
  var bounce = 0.5;

  ballVel.y += 0.18;
  ballPos.x += ballVel.x;
  ballPos.y += ballVel.y;

  var localPos = toLocal(ballPos.x, ballPos.y, boxX, boxY, angle);
  var localVel = rotateVector(ballVel.x, ballVel.y, -angle);

  if (localPos.x < -halfSize) {
    localPos.x = -halfSize;
    localVel.x = abs(localVel.x) * bounce;
  } else if (localPos.x > halfSize) {
    localPos.x = halfSize;
    localVel.x = -abs(localVel.x) * bounce;
  }

  if (localPos.y < -halfSize) {
    localPos.y = -halfSize;
    localVel.y = abs(localVel.y) * bounce;
  } else if (localPos.y > halfSize) {
    localPos.y = halfSize;
    localVel.y = -abs(localVel.y) * bounce;
  }

  var worldPos = toWorld(localPos.x, localPos.y, boxX, boxY, angle);
  var worldVel = rotateVector(localVel.x, localVel.y, angle);
  ballPos.x = worldPos.x;
  ballPos.y = worldPos.y;
  ballVel.x = worldVel.x * 0.998;
  ballVel.y = worldVel.y * 0.998;

  background(0);

  push();
  translate(boxX, boxY);
  rotate(angle);
  noStroke();
  fill(150, 70, 250);
  rect(0, 0, boxSize, boxSize);
  pop();

  noStroke();
  fill(255, 230, 70);
  ellipse(ballPos.x, ballPos.y, ballR * 2, ballR * 2);
}

function toLocal(x, y, originX, originY, angle) {
  var dx = x - originX;
  var dy = y - originY;
  var c = cos(angle);
  var s = sin(angle);
  return {
    x: dx * c + dy * s,
    y: -dx * s + dy * c
  };
}

function toWorld(x, y, originX, originY, angle) {
  var c = cos(angle);
  var s = sin(angle);
  return {
    x: originX + x * c - y * s,
    y: originY + x * s + y * c
  };
}

function rotateVector(x, y, angle) {
  var c = cos(angle);
  var s = sin(angle);
  return {
    x: x * c - y * s,
    y: x * s + y * c
  };
}
