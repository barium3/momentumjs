// 测试 for 循环生成多个图形
function draw() {
  // 循环创建 5 个椭圆
  for (let i = 0; i < 5; i++) {
    ellipse(100 + i * 50, 200, 30, 30);
  }
}
