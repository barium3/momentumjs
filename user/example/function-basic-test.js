// @filename: function-basic-test
// 函数定义和调用测试

function setup() {
  size(800, 400);
  noStroke();
}

function draw() {
  // 调用普通函数
  drawCircle(100, 200, 50, 'red');
  drawCircle(250, 200, 70, 'green');
  drawCircle(450, 200, 40, 'blue');

  // 调用带返回值的函数
  const result = addNumbers(10, 20);
  fill(255);
  text('10 + 20 = ' + result, 600, 200);

  // 调用递归函数
  const factorial5 = factorial(5);
  text('5! = ' + factorial5, 600, 250);
}

// 普通函数 - 绘制圆形
function drawCircle(x, y, radius, color) {
  if (color === 'red') {
    fill(255, 80, 80);
  } else if (color === 'green') {
    fill(80, 255, 80);
  } else if (color === 'blue') {
    fill(80, 80, 255);
  } else {
    fill(255);
  }
  ellipse(x, y, radius * 2, radius * 2);
}

// 带返回值的函数
function addNumbers(a, b) {
  return a + b;
}

// 递归函数 - 计算阶乘
function factorial(n) {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}
