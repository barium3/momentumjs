#includepath "~/Documents/;%USERPROFILE%Documents";
#include "motionjs/bundle/motion.js";


  m.createCanvas(720, 720);
  m.frameRate(30);

  noiseLayer = thisComp.layer("noise");
  targetLayer = thisComp.layer("input");
  point = [transform.position[0], transform.position[1]];
  let allImg = ['img1.jpg','img2.jpg','img3.jpg','img4.jpg','img5.jpg','img6.jpg','img7.jpg'];

  let steps = 720/14;

  for (let x = 0; x < width; x+= steps) {
      for (let y = 0; y < height; y+= steps) {

    // 获取噪声图层的颜色
    noiseColor = noiseLayer.pixels[y*img.width+x];
    grayNoise  = (noiseColor[0] + noiseColor[1] + noiseColor[2]) / 3;

   // 获取目标图层的颜色和透明度
    sampleColor = targetLayer.pixels[y*img.width+x];
    grayScaleValue = (sampleColor[0] + sampleColor[1] + sampleColor[2]) / 3;
    alpha = sampleColor[3]; // 获取alpha通道的值
    isTransparent = (alpha === 0); // 判断是否为透明

    if ((grayNoise == 0) || (isTransparent && grayScaleValue == 0)) {
      m.image(allImg[m.floor(m.random(6))],x,y,steps,steps);
    }

    }
  }