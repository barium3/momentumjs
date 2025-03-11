#includepath "~/Documents/;%USERPROFILE%Documents";
#include "motionjs/bundle/motion.js";

let bath = 1;
let contrast = 48;
colorArray = ["#F25430","#0583F2","#4AC2A2","#23468C","#EFCC8A"];

  m.createCanvas(1920, 1080);
  m.frameRate(30);

  for(let i = 0;i < 13;i+=1){
  drawShape(width/2,height/2+i*offset,500);
  }



function drawShape(x,y,r) {
  m.fill(colorArray[m.floor(m.random(0,5))]);
  m.strokeWeight(bath + random(0,1)*contrast);
  m.arc(x, y, r, r, startBath+random(-1,1)*startOffset, endBath+random(-1,1)*endOffset);

}

