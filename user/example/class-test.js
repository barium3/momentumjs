// 类与对象测试
// 这个测试演示了如何使用 ES6 Class 定义对象，并在 draw 循环中累积其状态

class Walker {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.tx = random(0, 1000);
    this.ty = random(10000, 20000);
  }

  step() {
    // 使用 noise 让运动更自然 (Accumulated change)
    this.x = map(noise(this.tx), 0, 1, 0, width);
    this.y = map(noise(this.ty), 0, 1, 0, height);
    
    // 累积时间偏移
    this.tx += 0.01;
    this.ty += 0.01;
  }
}

var w1, w2, w3;

function setup() {
  w1 = new Walker(width/2, height/2);
  w2 = new Walker(width/2 + 100, height/2);
  w3 = new Walker(width/2 - 100, height/2);
}

function draw() {
  // 更新状态
  w1.step();
  w2.step();
  w3.step();
  
  // 显式绘制图形
  // 注意：在 MomentumJS 当前版本中，必须显式调用绘图函数以便正确创建图层
  ellipse(w1.x, w1.y, 50, 50);
  ellipse(w2.x, w2.y, 30, 30);
  ellipse(w3.x, w3.y, 20, 20);
}
