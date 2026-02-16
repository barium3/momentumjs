// 测试 setup 中的 random 是否每帧重置
// 如果 random 每帧都重置，ellipse 的位置会每帧变化
// 如果 random 只执行一次，ellipse 的位置应该固定

var x, y; // 在 setup 中初始化的位置变量

function setup() {
  createCanvas(800, 600);
  frameRate(30);
  
  // 在 setup 中使用 random 初始化位置
  // 如果 setup 中的 random 每帧都重置，这个位置会每帧变化
  // 如果 setup 只执行一次，这个位置应该固定
  x = random(100, 700);
  y = random(100, 500);
}

function draw() {
  background(220);
  
  // 绘制在 setup 中初始化的 ellipse（红色）
  // 如果位置每帧变化，说明 setup 中的 random 每帧都重置
  // 如果位置固定，说明 setup 只执行一次
  fill(255, 0, 0);
  ellipse(x, y, 50, 50);
  
  // 在 draw 中也使用 random（绿色，这个应该每帧都变化）
  var x2 = random(100, 700);
  var y2 = random(100, 500);
  
  fill(0, 255, 0);
  ellipse(x2, y2, 30, 30);
}
