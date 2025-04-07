// 颜色模式与填充示例
m.background(240, 240, 240); // 设置背景色

// RGB 颜色模式
m.colorMode("RGB");
m.fill(255, 0, 0); // 红色填充
m.rect(50, 50, 100, 100);

m.stroke(0, 255, 0); // 绿色描边
m.noFill(); // 不填充
m.rect(200, 50, 100, 100);

// HSB 颜色模式
m.colorMode("HSB");
m.fill(240, 100, 100); // 蓝色填充
m.rect(350, 50, 100, 100);
