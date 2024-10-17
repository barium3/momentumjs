// m.translate(100,100);
// m.layerScale(80,100);
// m.image("./IMG_2251.png", 300, 100,30,20); // 使用文件路径
// m.image("selected", 100, 100,30,20); // 在位置(100, 100)添加图像
// m.image("IMG_2251.png", 200, 100,30,20); // 使用名为"我的图片"的项目
// m.image(1, 400, 100,30,20); // 使用索引为1的项目
// m.image("selected", 500, 100,30,20); // 使用选中的项目
// m.image(new File("./IMG_2251.png"), 600, 100,30,20); // 使用File对象

// m.image("path/to/image.png", 200, 200, 300, 200); // 在位置(200, 200)添加图像，并调整大小为300x200

// var pointController1 = m.pointController('time', 100);
// var pointController2 = m.pointController('time * 2', 200);

// var silderController1 = m.sliderController(100);
// var silderController2 = m.sliderController(200);

// var angleController1 = m.angleController(0);

// m.rotate(angleController1);
// m.line(pointController1[0], pointController1[1], pointController2[0], pointController2[1]);
// m.rect(silderController1, silderController2,100,100);
var img = m.loadImage("3-640x400(1).jpg");
m.image(img, 200, 200, 300, 400);

var anotherImg = m.loadImage("3-640x400(1).jpg");
m.image(anotherImg, 300, 300, 300, m.mul(m.time, 100));

var compItem = m.loadImage(1); // 加载索引为1的项目
m.image(compItem, 400, 400, 300, 400);

var selectedItem = m.loadImage("selected"); // 加载选中的项目
m.image(selectedItem, 500, 500, 300, 400);
