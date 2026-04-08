// createPoint(x, y) creates a draggable point controller in After Effects.
// Read its position with point.value(), which returns [x, y].
// You can also keyframe the point controller in AE to animate the overlaps over time.

let leftOverlap;
let rightOverlap;

function setup() {
  createCanvas(300, 300);
  leftOverlap = createPoint(width / 3, height * 0.5);
  rightOverlap = createPoint((width * 2) / 3, height * 0.5);
}

function draw() {
  var centerY = height * 0.5;
  var leftPos = leftOverlap.value();
  var rightPos = rightOverlap.value();
  var leftJoint = constrain(leftPos[0], 0, width);
  var rightJoint = constrain(rightPos[0], leftJoint, width);

  var leftCenterX = leftJoint * 0.5;
  var middleCenterX = (leftJoint + rightJoint) * 0.5;
  var rightCenterX = (rightJoint + width) * 0.5;

  var leftWidth = leftJoint;
  var middleWidth = rightJoint - leftJoint;
  var rightWidth = width - rightJoint;

  background(0);

  noStroke();
  fill(255, 230, 70);
  ellipse(leftCenterX, centerY, leftWidth, height);
  fill(255, 0, 170);
  ellipse(middleCenterX, centerY, middleWidth, height);
  fill(150, 70, 250);
  ellipse(rightCenterX, centerY, rightWidth, height);
}
