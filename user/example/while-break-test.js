// @filename: while-break-test
// While 循环配合 break 语句

function setup() {
  size(800, 400);
  noStroke();
}

function draw() {
  let x = 50;
  let count = 0;
  const maxShapes = 8;

  while (true) {
    // 达到最大数量时退出循环
    if (count >= maxShapes) {
      break;
    }

    fill(100 + count * 20, 150, 200);
    ellipse(x, 200, 40, 40);

    x += 90;
    count++;
  }
}
