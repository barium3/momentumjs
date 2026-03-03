// 测试 push/pop 对 textLeading 的保存和恢复
function setup() {
  size(1280, 720);
  background(240);
}

function draw() {
  background(240);
  
  // 初始状态
  textSize(20);
  textLeading(30);  // 显式设置行高
  fill(0);
  
  // 显示初始状态
  text("初始: textSize=20, textLeading=30", 50, 50);
  
  // 测试 push/pop
  push();
  
  // 在 push 内部修改状态
  textSize(40);
  textLeading(60);  // 显式设置新的行高
  fill(255, 100, 100);
  
  // 显示 push 内部的状态
  text("Push内: textSize=40, textLeading=60", 50, 150);
  
  pop();
  
  // pop 后应该恢复到初始状态
  fill(100, 255, 100);
  text("Pop后: textSize=20, textLeading=30 (应恢复)", 50, 250);
  
  // 测试嵌套 push/pop
  push();
  textSize(30);
  textLeading(45);
  fill(100, 100, 255);
  text("嵌套Push: textSize=30, textLeading=45", 50, 350);
  
  push();
  textSize(50);
  textLeading(75);
  fill(255, 200, 100);
  text("嵌套Push2: textSize=50, textLeading=75", 50, 450);
  pop();
  
  // 应该恢复到 textSize=30, textLeading=45
  fill(200, 100, 255);
  text("嵌套Pop后: textSize=30, textLeading=45 (应恢复)", 50, 550);
  pop();
  
  // 应该恢复到初始状态 textSize=20, textLeading=30
  fill(0);
  text("最终Pop后: textSize=20, textLeading=30 (应恢复)", 50, 650);
}
