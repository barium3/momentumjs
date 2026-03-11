// LoopAnalyzer consolidated cases.
// Covered:
// 1. random in for bounds / step
// 2. frameCount upper bound via duration + frameRate
// 3. controller value in for bounds
// 4. initless for with external loop var
// 5. while loop with monotonic update
// 6. do...while loop
// 7. branch-derived loop bound
// 8. chained bound variable
// 9. for...of over uncertain-length iterable
// 10. for...in over uncertain-size object

let amount;
let outerI;
let branchLimit;
let rawLimit;
let finalLimit;

function makePoints(count, y) {
  let pts = [];
  for (let i = 0; i < count; i++) {
    pts.push([60 + i * 36, y]);
  }
  return pts;
}

function makeObj(count) {
  let out = {};
  for (let i = 0; i < count; i++) {
    out["k" + i] = i;
  }
  return out;
}

function setup() {
  duration(1);
  frameRate(12);
  createCanvas(900, 720);
  amount = createSlider(0, 5, 2, 1);
}

function draw() {
  background(246);
  noStroke();

  // 1. random for
  fill(55, 125, 245);
  for (let i = random(2); i < random(6); i += floor(random(1, 3))) {
    rect(50 + i * 44, 50, 26, 26);
  }

  // 2. frameCount bound
  fill(240, 95, 95);
  for (let i = 0; i < frameCount; i++) {
    ellipse(50 + i * 24, 120, 12, 12);
  }

  // 3. controller for
  fill(55, 185, 120);
  for (let i = 0; i < amount.value(); i++) {
    ellipse(50 + i * 54, 190, 28, 28);
  }

  // 4. initless for
  fill(95, 110, 235);
  outerI = 0;
  for (; outerI < amount.value(); outerI++) {
    rect(50 + outerI * 54, 255, 28, 28);
  }

  // 5. while
  fill(230, 110, 90);
  let i = 0;
  while (i < amount.value()) {
    rect(50 + i * 54, 320, 26, 26);
    i++;
  }

  // 6. do...while
  fill(80, 130, 255);
  let j = 0;
  do {
    ellipse(50 + j * 54, 390, 24, 24);
    j++;
  } while (j < amount.value());

  // 7. conditional source
  fill(220, 75, 75);
  if (frameCount % 2 === 0) {
    branchLimit = random(4);
  } else {
    branchLimit = amount.value();
  }
  for (let k = 0; k < branchLimit; k++) {
    rect(50 + k * 54, 455, 24, 24);
  }

  // 8. conditional + chain
  fill(65, 120, 240);
  if (frameCount % 2 === 0) {
    rawLimit = random(5);
  } else {
    rawLimit = amount.value();
  }
  finalLimit = rawLimit + 1;
  for (let m = 0; m < finalLimit; m++) {
    ellipse(50 + m * 48, 520, 22, 22);
  }

  // 9. for...of
  fill(80, 150, 255);
  for (let p of makePoints(amount.value(), 600)) {
    ellipse(p[0], p[1], 20, 20);
  }

  // 10. for...in
  fill(45, 170, 120);
  let idx = 0;
  for (let key in makeObj(amount.value())) {
    rect(50 + idx * 50, 660, 22, 22);
    idx++;
  }
}
