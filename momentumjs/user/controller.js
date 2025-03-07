var pointController1 = m.pointController("time", 100);
var pointController2 = m.pointController("time * 2", 200);

var silderController1 = m.sliderController(100);
var silderController2 = m.sliderController(200);

var angleController1 = m.angleController(0);

m.colorMode("RGB");

// m.background(255,0,0);

m.rotate(angleController1);
// m.line(pointController1[0], pointController1[1], pointController2[0], pointController2[1]);
m.rect(silderController1, silderController2, 100, 100);
m.line(0, 0, 100, m.mul(m.time, 100));
// // 使用 RGB 值
// var redColor = m.colorController(255, 0, 0);

// // 使用十六进制字符串
// var greenColor = m.colorController("#00FF00");

// // 使用 HSB 值
// m.colorMode("HSB");
// var blueColor = m.colorController(240, 100, 100);

// // 使用 CMYK 值
// m.colorMode("CMYK");
// var yellowColor = m.colorController(0, 0, 100, 0);

// m.fill(redColor);
// m.rect(100, 100, 100, 100);

// m.fill(greenColor);
// // alert(greenColor);
// m.ellipse(300, 300, 100, 100);

// m.stroke(blueColor);
// m.line(0, 0, 500, 500);

// m.fill(yellowColor);
// m.triangle(200, 200, 300, 300, 400, 200);
