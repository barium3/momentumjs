// #include "/Library/Application Support/Adobe/CEP/extensions/movementjs/bundle/movement.js";

//   // Create p5.Color objects to interpolate between.
var from = m.color("#FF0000");
var to = m.color("#0000FF");

// Create intermediate colors.
var interA = m.lerpColor(from, to, 0.33);
var interB = m.lerpColor(from, to, 0.66);

m.translate(m.time, 100, 100);
// Draw the left rectangle.
//  m.noStroke();
m.fill(from);
m.translate(100, 100, 100);
m.ellipse(10, 20, 20, 60);

// Draw the left-center rectangle.
m.noFill();
m.ellipse(30, 20, 20, 60);

// Draw the right-center rectangle.
m.fill(interB);
m.ellipse(50, 20, 20, 60);

// Draw the right rectangle.
m.fill(to);
m.ellipse(70, 20, 20, 60);
