// ----------------------------------------
// frameRate(fps) sets the composition frame rate.
// duration(seconds) sets the comp length in seconds.
// duration(h, m, s, f) also works, using hours / minutes / seconds / frames.
// For example:
// duration(6);
// duration(0, 0, 5, 12);
// ----------------------------------------

function setup() {
  createCanvas(400, 400);

  // Active example: set the comp to 6 seconds.
  duration(6);
  // Alternative: 5 seconds + 12 frames at the current frame rate.
  // duration(0, 0, 5, 12);
  // Alternative: 1 minute exactly.
  // duration(0, 1, 0, 0);

  // Set the comp frame rate.
  frameRate(24);
  noStroke();
}

function draw() {
  background(0);
  textAlign(CENTER, CENTER);
  fill(100);
  textSize(88);
  text(nf(frameCount / 24, 1, 2) + " s", width / 2, height / 2);
}
