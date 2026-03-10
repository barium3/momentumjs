// @filename: slot-key-binding-test
//
// 这个例子专门用来验证新的 slotKey 绑定方案是否可行。
// 覆盖 3 种容易错位的来源：
// 1. helper 函数里的渲染调用
// 2. 同一个 helper 同时被 setup / draw 调用
// 3. draw 中条件分支前置了同类型 shape，后面还有同类型 shape
//
// 建议验证方式：
// 1. 运行后打开生成的合成
// 2. 查看 draw 阶段生成的 Shapes_* 组表达式
// 3. 确认表达式里已经不是旧的 targetId 数字，而是 targetKey
// 4. targetKey 应该类似：
//    - "setup:__mcs_x:1"
//    - "draw:__mcs_x:1"
//    - "draw:__mcs_y:1"
// 5. 重点看 draw 里“红色条件圆”和“蓝色常驻圆”是两个不同 callsite
//    即使红色圆消失，蓝色圆对应的 targetKey 也不应该漂移

var ringPainter;

function sharedDot(x, y, size, r, g, b) {
  noStroke();
  fill(r, g, b, 180);
  ellipse(x, y, size, size);
}

function drawConditionalCircle() {
  fill(255, 90, 90);
  noStroke();
  ellipse(165, 72, 74, 74);
}

function drawStableCircle() {
  fill(65, 125, 255);
  noStroke();
  ellipse(165, 152, 40, 40);
}

function RingPainter() {
  this.render = function (y) {
    noFill();
    stroke(0, 165, 255);
    strokeWeight(6);
    ellipse(width - 82, y, 56, 56);
  };
}

function setup() {
  createCanvas(320, 220);
  ringPainter = new RingPainter();

  // setup 中调用 helper
  sharedDot(72, 62, 42, 255, 145, 80);
}

function draw() {
  background(244);

  // draw 中再次调用同一个 helper
  // 新方案下这里应该和 setup 中的同一 callsite 拆成不同 phase：
  // - setup:callsite:1
  // - draw:callsite:1
  sharedDot(72, 62, 42, 255, 145, 80);

  // 条件分支中的 ellipse
  if (frameCount % 60 < 30) {
    drawConditionalCircle();
  }

  // 同类型但始终存在的 ellipse
  // 旧的 type+count 方案里，这个调用点容易被前面的条件圆“挤占编号”
  drawStableCircle();

  // 类方法中的 ellipse
  ringPainter.render(110 + sin(frameCount * 0.08) * 34);

  fill(30);
  noStroke();
  textSize(12);
  text("slot-key test", 16, height - 18);
}
