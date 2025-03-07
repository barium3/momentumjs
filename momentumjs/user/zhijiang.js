#includepath "~/Documents/;%USERPROFILE%Documents";
#include "motionjs/bundle/motion.js";


m.createCanvas(1920, 1080);
m.frameRate(30);

let minWeight =0;
let maxWeight = 160;
point2 = effect("点控制")("点");

m.fill(255, 241, 0);
noStroke();

var middleScreen = width / 2;
var distanceToMiddle = m.floor(point2[0] - middleScreen);
var distanceBetweenPoints = map(distanceToMiddle, 0, middleScreen, maxWeight, minWeight);

beginShape();
  m.vertex(width / 2, height / 2);
  m.vertex(point2[0],point[1]);
  m.vertex(point2[0], point2[1] + distanceBetweenPoints);
endShape();