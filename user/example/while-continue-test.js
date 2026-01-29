// @filename: while-continue-test
// While 循环配合 continue 语句

function setup() {
  size(800, 400);
  noStroke();
}

function draw() {
  let i = 0;

  while (i < 10) {
    i++;

    // 跳过偶数索引
    if (i % 2 === 0) {
      continue;
    }

    // 只绘制奇数位置的椭圆
    fill(255, 100 + i * 15, 100);
    ellipse(80 + (i - 1) * 70, 200, 40, 40);
  }
}
