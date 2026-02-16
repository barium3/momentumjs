// 测试每帧变化
var baseRadius = 50;

function draw() {
  // radius 随 frameCount 增加
  var radius = baseRadius + frameCount;
  ellipse(centerX, centerY, radius, radius);
}
