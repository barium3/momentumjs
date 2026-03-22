const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 720;
const SAMPLE_TEXT = "momentum.js";
const BASELINE_OFFSET = 22;

const THICKNESS_SAMPLES = [
  { y: 360, scale: 3.8, depthX: 26, depthY: 20, frontWeight: 2.2, backWeight: 1.3 },
];

let sampleCommands = [];
let sampleAdvance = 0;

function setup() {
  createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  frameRate(30);
  sampleCommands = getPathCommandsForText(SAMPLE_TEXT);
  sampleAdvance = measureTextAdvance(SAMPLE_TEXT);
}

function draw() {
  background(0);

  for (let i = 0; i < THICKNESS_SAMPLES.length; i += 1) {
    const sample = THICKNESS_SAMPLES[i];
    const startX = width * 0.5 - sampleAdvance * sample.scale * 0.5;
    drawExtrudedPath(
      sampleCommands,
      startX,
      sample.y,
      sample.scale,
      sample.depthX,
      sample.depthY,
      sample.frontWeight,
      sample.backWeight,
    );
  }
}

function drawExtrudedPath(cmds, x, y, scale, depthX, depthY, frontWeight, backWeight) {
  let currentX = 0;
  let currentY = 0;

  for (let i = 0; i < cmds.length; i += 1) {
    const cmd = cmds[i];

    if (cmd.type === "M") {
      currentX = cmd.x;
      currentY = cmd.y;
      continue;
    }

    if (cmd.type === "L") {
      const x0 = x + currentX * scale;
      const y0 = y + (currentY - BASELINE_OFFSET) * scale;
      const x1 = x + cmd.x * scale;
      const y1 = y + (cmd.y - BASELINE_OFFSET) * scale;

      drawExtrudedSegment(
        x0,
        y0,
        x1,
        y1,
        depthX,
        depthY,
        frontWeight,
        backWeight,
      );

      currentX = cmd.x;
      currentY = cmd.y;
    }
  }
}

function drawExtrudedSegment(x0, y0, x1, y1, depthX, depthY, frontWeight, backWeight) {
  const backX0 = x0 + depthX;
  const backY0 = y0 + depthY;
  const backX1 = x1 + depthX;
  const backY1 = y1 + depthY;

  noStroke();
  fill(70, 125, 190);
  quad(x0, y0, x1, y1, backX1, backY1, backX0, backY0);

  stroke(45, 88, 138);
  strokeWeight(backWeight);
  line(backX0, backY0, backX1, backY1);

  stroke(255);
  strokeWeight(frontWeight);
  line(x0, y0, x1, y1);
}

function measureTextAdvance(textValue) {
  let advance = 0;

  for (let i = 0; i < textValue.length; i += 1) {
    const glyph = HERSHEY_FUTURAL[textValue.charAt(i)];
    if (glyph) {
      advance += glyph.advance * 2;
    } else {
      advance += 10;
    }
  }

  return advance;
}

function getPathCommandsForText(textValue) {
  let commands = [];
  let offset = 0;

  for (let i = 0; i < textValue.length; i += 1) {
    const glyph = HERSHEY_FUTURAL[textValue.charAt(i)];

    if (glyph) {
      const glyphCommands = getPathCommandsForChar(glyph.path, offset);
      Array.prototype.push.apply(commands, glyphCommands);
      offset += glyph.advance * 2;
    } else {
      offset += 10;
    }
  }

  return commands;
}

function getPathCommandsForChar(path, offset) {
  let commands = [];
  let mode = "";
  const segments = path.split(" ");

  for (let i = 0; i < segments.length; i += 1) {
    let segment = segments[i];

    if (segment.charAt(0) === "M" || segment.charAt(0) === "L") {
      mode = segment.charAt(0);
      segment = segment.substring(1);
    }

    const coords = segment.split(",");
    if (coords.length !== 2) {
      continue;
    }

    if (mode === "M") {
      commands.push({
        type: "M",
        x: int(coords[0]) + offset,
        y: int(coords[1]),
      });
    } else if (mode === "L") {
      commands.push({
        type: "L",
        x: int(coords[0]) + offset,
        y: int(coords[1]),
      });
    }
  }

  return commands;
}

const HERSHEY_FUTURAL = {
  ".": {
    path: "M4,17 L3,18 4,19 5,18 4,17",
    advance: 4,
  },
  "e": {
    path: "M3,14 L15,14 15,12 14,10 13,9 11,8 8,8 6,9 4,11 3,14 3,16 4,19 6,21 8,22 11,22 13,21 15,19",
    advance: 9,
  },
  "j": {
    path: "M5,1 L6,2 7,1 6,0 5,1 M6,8 L6,25 5,28 3,29 1,29",
    advance: 5,
  },
  "m": {
    path: "M4,8 L4,22 M4,12 L7,9 9,8 12,8 14,9 15,12 15,22 M15,12 L18,9 20,8 23,8 25,9 26,12 26,22",
    advance: 15,
  },
  "n": {
    path: "M4,8 L4,22 M4,12 L7,9 9,8 12,8 14,9 15,12 15,22",
    advance: 10,
  },
  "o": {
    path: "M8,8 L6,9 4,11 3,14 3,16 4,19 6,21 8,22 11,22 13,21 15,19 16,16 16,14 15,11 13,9 11,8 8,8",
    advance: 10,
  },
  "s": {
    path: "M14,11 L13,9 10,8 7,8 4,9 3,11 4,13 6,14 11,15 13,16 14,18 14,19 13,21 10,22 7,22 4,21 3,19",
    advance: 9,
  },
  "t": {
    path: "M5,1 L5,18 6,21 8,22 10,22 M2,8 L9,8",
    advance: 7,
  },
  "u": {
    path: "M4,8 L4,18 5,21 7,22 10,22 12,21 15,18 M15,8 L15,22",
    advance: 10,
  },
};
