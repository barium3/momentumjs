// @filename: background-test
// 测试 background 函数（纯色图层，效果-生成-填色）

function setup() {
  size(800, 400);
}

function draw() {
  // 底层背景
  background(50);

  // 叠加半透明红色（按执行顺序，在上层）
  background(255, 0, 0, 100);
}
