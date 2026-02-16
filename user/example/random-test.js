// 测试 random / randomSeed / randomGaussian
// 用随机数驱动圆的位置和大小，便于在 AE 中观察效果

function setup() {
  randomSeed(100);
}

function draw() {
  var x = random(50, 250);
  var y = random(50, 250);
  var r = 15 + randomGaussian(0, 8);
  if (r < 5) r = 5;
  if (r > 40) r = 40;
  ellipse(x, y, r * 2, r * 2);
}
