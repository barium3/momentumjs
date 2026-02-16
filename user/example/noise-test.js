// 测试 noise / noiseSeed / noiseDetail
// 用噪声驱动圆的位置和大小，便于在 AE 中观察效果

function setup() {
  noiseSeed(100);
  noiseDetail(4, 0.5);
}

function draw() {
  var t = frameCount * 0.05;
  var x = 50 + noise(t) * 200;
  var y = 50 + noise(t + 100) * 200;
  var r = 20 + noise(t + 200) * 30;
  ellipse(x, y, r * 2, r * 2);
}
