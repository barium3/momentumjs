// @filename: nested-function-test
// 嵌套函数和闭包测试

function setup() {
  size(800, 400);
  noStroke();
}

function draw() {
  // 使用工厂函数创建多个形状生成器
  const createShapeDrawer = function(color) {
    // 内部函数（闭包）
    return function(x, y, size) {
      fill(color);
      ellipse(x, y, size, size);
    };
  };

  // 创建不同颜色的形状绘制器
  const drawRed = createShapeDrawer({ r: 255, g: 80, b: 80 });
  const drawGreen = createShapeDrawer({ r: 80, g: 255, b: 80 });
  const drawBlue = createShapeDrawer({ r: 80, g: 80, b: 255 });

  // 使用工厂函数创建的绘制器
  drawRed(150, 150, 60);
  drawGreen(300, 200, 50);
  drawBlue(450, 150, 70);

  // 使用计数器闭包
  const counter = createCounter();

  for (let i = 0; i < 5; i++) {
    const value = counter();
    fill(255, 200, 100);
    ellipse(600 + i * 30, 300, value * 5, value * 5);
  }
}

// 创建计数器的工厂函数
function createCounter() {
  let count = 0;

  // 返回内部函数，形成闭包
  return function() {
    count++;
    return count;
  };
}
