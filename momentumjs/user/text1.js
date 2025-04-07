// m.layerAnchor(100, 100);
// m.layerRotate(100);
// m.translate(100, 100,100);
// m.strokeWeight(10);
m.stroke(255, 255, 0);
// m.anchor(-100, -100);
// m.rect(0, 0, 200, 200);
// m.ellipse(0, 0, 200, 200);

// m.polygon(10, 0, 200, 5);
// m.line("100 + time * 50", "100", "200", "200 + Math.sin(time) * 100");
m.beginShape();
m.vertex(100, 100, 50, 50, 10, 10);
m.vertex("time * 100", 100);
m.vertex(200, 200);
m.vertex(100, 200);
m.endShape(true);

// m.quad(500, 100, 200, 100, 200, 200, 100, 200);
