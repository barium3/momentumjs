const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 720;
const WORD_SIZE = 108;
const BACKGROUND_COLOR = 0;
const TEXT_COLOR = 255;
const HORIZONTAL_MARGIN = 0;
const DOT_Y_OFFSET = WORD_SIZE * 0.34;

const PARTICLE_ALPHA = 255;
const DOT_PARTICLE_WEIGHT = 6;
const FLASH_DURATION_FRAMES = 6;
const FLASH_COOLDOWN_FRAMES = 18;
const CLUSTER_FLASH_COLOR = [0, 255, 210];
const SEPARATION_FLASH_COLOR = [255, 140, 70];
const ALIGNMENT_FLASH_COLOR = [180, 120, 255];
const FLASH_COLOR_PALETTE = [
  CLUSTER_FLASH_COLOR,
  SEPARATION_FLASH_COLOR,
  ALIGNMENT_FLASH_COLOR,
];

const HOME_BAND_INDEX = 2;
const FIXED_BOID_COUNT = 60;
const BAND_Y_EASING = 0.32;
const BAND_X_EASING = 0.36;
const POINT_MOVE_START_DISTANCE = 1.5;
const POINT_STOP_FRAMES = 6;
const POINT_STOP_DISTANCE = 0.18;
const BOIDS_PER_FRAME_IN = 8;
const BOIDS_PER_FRAME_OUT = 4;
const ENTRY_TRANSITION_FRAMES = 48;
const ENTRY_BEHAVIOR_FLOOR = 0.18;
const ENTRY_THRUST = 0.42;
const WANDER_TARGET_HOLD_FRAMES = 12;

const CONTROL_BAND_CONFIGS = [
  { key: "maxSpeed", label: "Speed", min: 0, max: 15, defaultValue: 1.5 },
  {
    key: "maxForce",
    label: "Steering",
    min: 0.01,
    max: 0.4,
    defaultValue: 0.139,
  },
  {
    key: "separation",
    label: "Dispersion",
    min: 0,
    max: 15,
    defaultValue: 9.9,
  },
  {
    key: "alignment",
    label: "Alignment",
    min: 0,
    max: 15,
    defaultValue: 4.95,
  },
];

const CENTER_BAND_CONFIG = {
  key: "seek",
  label: "Wander",
  min: 0,
  max: 15,
  defaultValue: 4.95,
};

const TOTAL_BANDS = CONTROL_BAND_CONFIGS.length + 1;
const ALL_CONTROL_CONFIGS = [...CONTROL_BAND_CONFIGS, CENTER_BAND_CONFIG];
const HOME_LABELS = {
  momentum: "momentum",
  js: "js",
  dot: ".",
};

const SCRAMBLE_FRAMES = 16;
const LETTER_ROLL_STAGGER = 1.5;
const MOVEMENT_ROLL_STAGGER = 1.1;
const MOVEMENT_ROLL_SPEED = 1.2;
const UPPERCASE_ROLL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE_ROLL_CHARS = "abcdefghijklmnopqrstuvwxyz";
const MERGE_ZONE_X_PADDING = WORD_SIZE * 0.16;
const MERGE_ZONE_Y_PADDING = WORD_SIZE * 0.22;

const SETTING_EASING = {
  maxSpeed: 0.26,
  maxForce: 0.26,
  separation: 0.26,
  alignment: 0.26,
  seek: 0.26,
};

let boidSystem;
let wordTokens = [];
let targetSettings = {};
let smoothedSettings = {};
let mergedWordState = {
  active: true,
  bandIndex: HOME_BAND_INDEX,
  justActivated: false,
  justDeactivated: false,
  momentumDisplayLabel: HOME_LABELS.momentum,
  jsDisplayLabel: HOME_LABELS.js,
  momentumStartLabel: HOME_LABELS.momentum,
  jsStartLabel: HOME_LABELS.js,
  scrambleFrame: SCRAMBLE_FRAMES,
};
let dotAnchor;
let momentumPoint;
let jsPoint;

function setup() {
  createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  duration(20);
  frameRate(30);
  applyLabelTypography();

  initializeSettings();
  initializeControllersAndTokens();
  dotAnchor = computeDotAnchor();

  boidSystem = new Flock(FIXED_BOID_COUNT, dotAnchor);
}

function draw() {
  background(BACKGROUND_COLOR);

  updateMergedState();
  updateTokens();
  updateControlState();
  dotAnchor = computeDotAnchor();

  if (mergedWordState.active) {
    drawMergedWord();
  } else {
    for (let i = 0; i < wordTokens.length; i += 1) {
      wordTokens[i].draw();
    }
  }

  boidSystem.run(
    {
      maxSpeed: smoothedSettings.maxSpeed,
      maxForce: smoothedSettings.maxForce,
      separation: smoothedSettings.separation,
      alignment: smoothedSettings.alignment,
      seek: smoothedSettings.seek,
      dotAnchor: dotAnchor,
    },
    mergedWordState.active ? 1 : FIXED_BOID_COUNT,
    dotAnchor,
  );
}

function withLabelTypography(callback) {
  push();
  applyLabelTypography();
  const result = callback();
  pop();
  return result;
}

function measureLabelWidth(label) {
  return withLabelTypography(() => textWidth(label));
}

function getLabelMetrics(label) {
  const metrics = withLabelTypography(() => ({
    width: textWidth(label),
    ascent: textAscent(),
    descent: textDescent(),
  }));

  return {
    width: metrics.width,
    ascent: metrics.ascent,
    descent: metrics.descent,
  };
}

function applyLabelTypography() {
  textFont("Helvetica Neue UltraLight");
  textSize(WORD_SIZE);
  textAlign(CENTER, BASELINE);
}

function labelBaselineY(centerY, metrics) {
  return centerY + (metrics.ascent - metrics.descent) * 0.5;
}

function drawLabelText(label, centerX, centerY, metrics) {
  const labelMetrics = metrics || getLabelMetrics(label);
  const baselineY = labelBaselineY(centerY, labelMetrics);
  applyLabelTypography();
  text(label, centerX, baselineY);
}

function centeredMetricsBounds(metrics, centerX, centerY) {
  const baselineY = labelBaselineY(centerY, metrics);

  return {
    left: centerX - metrics.width * 0.5,
    right: centerX + metrics.width * 0.5,
    top: baselineY - metrics.ascent,
    bottom: baselineY + metrics.descent,
  };
}

function alphabetForCharacter(character) {
  if (character >= "A" && character <= "Z") {
    return UPPERCASE_ROLL_CHARS;
  }
  if (character >= "a" && character <= "z") {
    return LOWERCASE_ROLL_CHARS;
  }
  return null;
}

function rolledCharacterForTarget(startCharacter, targetCharacter, progress) {
  if (targetCharacter === " ") {
    return " ";
  }

  if (progress >= 1) {
    return targetCharacter;
  }

  const alphabet = alphabetForCharacter(targetCharacter);
  if (!alphabet) {
    return progress >= 0.6 ? targetCharacter : startCharacter || targetCharacter;
  }

  const targetIndex = alphabet.indexOf(targetCharacter);
  const safeStartCharacter = startCharacter || targetCharacter;
  const fallbackStartCharacter =
    targetCharacter === targetCharacter.toUpperCase()
      ? safeStartCharacter.toUpperCase()
      : safeStartCharacter.toLowerCase();
  const startIndex = max(0, alphabet.indexOf(fallbackStartCharacter));
  const rollDistance =
    (targetIndex - startIndex + alphabet.length) % alphabet.length;
  const easedProgress = 1 - pow(1 - progress, 2.4);
  const step = min(rollDistance, floor(easedProgress * (rollDistance + 1)));

  return alphabet.charAt((startIndex + step) % alphabet.length);
}

function rollingLabelForTarget(startLabel, targetLabel, scrambleFrame) {
  let output = "";

  for (let i = 0; i < targetLabel.length; i += 1) {
    const localFrame = constrain(
      scrambleFrame - i * LETTER_ROLL_STAGGER,
      0,
      SCRAMBLE_FRAMES,
    );
    const progress = localFrame / SCRAMBLE_FRAMES;
    output += rolledCharacterForTarget(
      startLabel.charAt(i),
      targetLabel.charAt(i),
      progress,
    );
  }

  return output;
}

function rollingLabelWhileMoving(baseLabel, rollFrame) {
  let output = "";

  for (let i = 0; i < baseLabel.length; i += 1) {
    const character = baseLabel.charAt(i);
    const alphabet = alphabetForCharacter(character);

    if (!alphabet) {
      output += character;
      continue;
    }

    const startIndex = alphabet.indexOf(character);
    const localFrame = max(0, rollFrame - i * MOVEMENT_ROLL_STAGGER);
    const step = floor(localFrame * MOVEMENT_ROLL_SPEED);
    output += alphabet.charAt((startIndex + step) % alphabet.length);
  }

  return output;
}

function initializeSettings() {
  for (let i = 0; i < ALL_CONTROL_CONFIGS.length; i += 1) {
    const config = ALL_CONTROL_CONFIGS[i];
    targetSettings[config.key] = config.defaultValue;
    smoothedSettings[config.key] = config.defaultValue;
  }
}

function initializeControllersAndTokens() {
  const layout = mergedLayoutForBand(HOME_BAND_INDEX);

  momentumPoint = createPoint(layout.momentumX, layout.targetY);
  jsPoint = createPoint(layout.jsX, layout.targetY);

  wordTokens = [
    new PointDrivenToken(HOME_LABELS.momentum, momentumPoint),
    new PointDrivenToken(HOME_LABELS.js, jsPoint),
  ];

  wordTokens[0].snapTo(layout.momentumX, layout.targetY);
  wordTokens[1].snapTo(layout.jsX, layout.targetY);
}

function startMergedLabelTransition(momentumLabel, jsLabel) {
  mergedWordState.momentumStartLabel = momentumLabel;
  mergedWordState.jsStartLabel = jsLabel;
  mergedWordState.momentumDisplayLabel = momentumLabel;
  mergedWordState.jsDisplayLabel = jsLabel;
  mergedWordState.scrambleFrame = 0;
}

function updateMergedLabelDisplay() {
  if (
    mergedWordState.momentumDisplayLabel === HOME_LABELS.momentum &&
    mergedWordState.jsDisplayLabel === HOME_LABELS.js &&
    mergedWordState.scrambleFrame >= SCRAMBLE_FRAMES
  ) {
    return;
  }

  mergedWordState.scrambleFrame += 1;

  if (mergedWordState.scrambleFrame >= SCRAMBLE_FRAMES) {
    mergedWordState.momentumDisplayLabel = HOME_LABELS.momentum;
    mergedWordState.jsDisplayLabel = HOME_LABELS.js;
    return;
  }

  mergedWordState.momentumDisplayLabel = rollingLabelForTarget(
    mergedWordState.momentumStartLabel,
    HOME_LABELS.momentum,
    mergedWordState.scrambleFrame,
  );
  mergedWordState.jsDisplayLabel = rollingLabelForTarget(
    mergedWordState.jsStartLabel,
    HOME_LABELS.js,
    mergedWordState.scrambleFrame,
  );
}

function updateMergedState() {
  const wasActive = mergedWordState.active;
  const bandA = bandIndexForY(momentumPoint.y());
  const bandB = bandIndexForY(jsPoint.y());
  const nextActive = bandA === bandB && mergedControllersInsideZone(bandA);

  mergedWordState.active = nextActive;
  mergedWordState.justActivated = !wasActive && nextActive;
  mergedWordState.justDeactivated = wasActive && !nextActive;

  if (nextActive) {
    mergedWordState.bandIndex = bandA;
    if (mergedWordState.justActivated) {
      startMergedLabelTransition(
        wordTokens[0].displayLabel,
        wordTokens[1].displayLabel,
      );
    }
    updateMergedLabelDisplay();
  }
}

function updateTokens() {
  for (let i = 0; i < wordTokens.length; i += 1) {
    wordTokens[i].updateFromController();
    if (mergedWordState.justDeactivated) {
      wordTokens[i].snapVisualToController();
    }
  }
}

function updateControlState() {
  const bandControllers = {
    maxSpeed: [],
    maxForce: [],
    separation: [],
    alignment: [],
    seek: [],
  };

  if (!mergedWordState.active) {
    for (let i = 0; i < wordTokens.length; i += 1) {
      const token = wordTokens[i];
      const config = bandConfigForIndex(token.confirmedBandIndex);
      if (config) {
        bandControllers[config.key].push(token.confirmedNormalizedX());
      }
    }
  }

  for (let i = 0; i < ALL_CONTROL_CONFIGS.length; i += 1) {
    const config = ALL_CONTROL_CONFIGS[i];
    const values = bandControllers[config.key];

    if (values.length > 0) {
      let sum = 0;
      for (let j = 0; j < values.length; j += 1) {
        sum += values[j];
      }

      targetSettings[config.key] = lerp(
        config.min,
        config.max,
        sum / values.length,
      );
    }

    smoothedSettings[config.key] = lerp(
      smoothedSettings[config.key],
      targetSettings[config.key],
      SETTING_EASING[config.key],
    );
  }
}

function bandCenterY(index) {
  const bandHeight = height / TOTAL_BANDS;
  return index * bandHeight + bandHeight * 0.5;
}

function bandIndexForY(y) {
  return constrain(floor(constrain(y, 0, height - 1) / (height / TOTAL_BANDS)), 0, TOTAL_BANDS - 1);
}

function bandConfigForIndex(bandIndex) {
  if (bandIndex === HOME_BAND_INDEX) {
    return CENTER_BAND_CONFIG;
  }

  if (bandIndex < HOME_BAND_INDEX) {
    return CONTROL_BAND_CONFIGS[bandIndex];
  }

  return CONTROL_BAND_CONFIGS[bandIndex - 1];
}

function mergedLayoutForBand(bandIndex) {
  const targetY = bandCenterY(bandIndex);
  const momentumWidth = measureLabelWidth(HOME_LABELS.momentum);
  const periodWidth = measureLabelWidth(HOME_LABELS.dot);
  const jsWidth = measureLabelWidth(HOME_LABELS.js);
  const totalWidth = momentumWidth + periodWidth + jsWidth;
  const startX = width * 0.5 - totalWidth * 0.5;

  return {
    targetY: targetY,
    momentumX: startX + momentumWidth * 0.5,
    jsX: startX + momentumWidth + periodWidth + jsWidth * 0.5,
  };
}

function controllerInsideMergedSlot(controllerX, controllerY, slotX, slotY, label) {
  const halfWidth = measureLabelWidth(label) * 0.5 + MERGE_ZONE_X_PADDING;
  const halfHeight = WORD_SIZE * 0.5 + MERGE_ZONE_Y_PADDING;

  return (
    abs(controllerX - slotX) <= halfWidth &&
    abs(controllerY - slotY) <= halfHeight
  );
}

function mergedControllersInsideZone(bandIndex) {
  const layout = mergedLayoutForBand(bandIndex);

  return (
    controllerInsideMergedSlot(
      momentumPoint.x(),
      momentumPoint.y(),
      layout.momentumX,
      layout.targetY,
      HOME_LABELS.momentum,
    ) &&
    controllerInsideMergedSlot(
      jsPoint.x(),
      jsPoint.y(),
      layout.jsX,
      layout.targetY,
      HOME_LABELS.js,
    )
  );
}

function drawMergedWord() {
  const layout = mergedLayoutForBand(mergedWordState.bandIndex);
  const momentumMetrics = getLabelMetrics(mergedWordState.momentumDisplayLabel);
  const jsMetrics = getLabelMetrics(mergedWordState.jsDisplayLabel);

  push();
  noStroke();
  fill(TEXT_COLOR);
  drawLabelText(
    mergedWordState.momentumDisplayLabel,
    layout.momentumX,
    layout.targetY,
    momentumMetrics,
  );
  drawLabelText(
    mergedWordState.jsDisplayLabel,
    layout.jsX,
    layout.targetY,
    jsMetrics,
  );
  pop();
}

function computeDotAnchor() {
  if (mergedWordState.active) {
    const layout = mergedLayoutForBand(mergedWordState.bandIndex);
    const momentumBounds = centeredMetricsBounds(
      getLabelMetrics(mergedWordState.momentumDisplayLabel),
      layout.momentumX,
      layout.targetY,
    );
    const jsBounds = centeredMetricsBounds(
      getLabelMetrics(mergedWordState.jsDisplayLabel),
      layout.jsX,
      layout.targetY,
    );

    return createVector(
      (momentumBounds.right + jsBounds.left) * 0.5,
      layout.targetY + DOT_Y_OFFSET,
    );
  }

  const boundsA = wordTokens[0].bounds();
  const boundsB = wordTokens[1].bounds();
  const leftBounds = boundsA.left <= boundsB.left ? boundsA : boundsB;
  const rightBounds = leftBounds === boundsA ? boundsB : boundsA;

  return createVector(
    (leftBounds.right + rightBounds.left) * 0.5,
    (wordTokens[0].y + wordTokens[1].y) * 0.5 + DOT_Y_OFFSET,
  );
}

function edgeSpawnData(target) {
  const side = floor(random(4));
  let x = 0;
  let y = 0;

  if (side === 0) {
    x = random(width);
    y = -16;
  } else if (side === 1) {
    x = width + 16;
    y = random(height);
  } else if (side === 2) {
    x = random(width);
    y = height + 16;
  } else {
    x = -16;
    y = random(height);
  }

  const velocity = p5.Vector.sub(target, createVector(x, y));
  velocity.normalize();
  velocity.mult(lerp(11.5, 18.5, pow(random(), 0.22)));

  return { x: x, y: y, velocity: velocity };
}

function randomFlashColor() {
  return FLASH_COLOR_PALETTE[floor(random(FLASH_COLOR_PALETTE.length))].slice();
}

class PointDrivenToken {
  constructor(homeLabel, controller) {
    this.homeLabel = homeLabel;
    this.controller = controller;
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.bandIndex = HOME_BAND_INDEX;
    this.displayLabel = "";
    this.targetLabel = "";
    this.transitionStartLabel = "";
    this.movementRollFrame = 0;
    this.displayMetrics = getLabelMetrics(homeLabel);
    this.targetLabelWidth = measureLabelWidth(homeLabel);
    this.committedLabel = homeLabel;
    this.scrambleFrame = SCRAMBLE_FRAMES;
    this.confirmedBandIndex = HOME_BAND_INDEX;
    this.confirmedX = controller.x();
    this.lastControllerX = controller.x();
    this.lastControllerY = controller.y();
    this.movementInProgress = false;
    this.stopFrames = POINT_STOP_FRAMES;

    this.resetToHome(controller.x(), controller.y());
  }

  resetToHome(x, y) {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.bandIndex = HOME_BAND_INDEX;
    this.displayLabel = this.homeLabel;
    this.targetLabel = this.homeLabel;
    this.transitionStartLabel = this.homeLabel;
    this.movementRollFrame = 0;
    this.displayMetrics = getLabelMetrics(this.homeLabel);
    this.targetLabelWidth = measureLabelWidth(this.homeLabel);
    this.committedLabel = this.homeLabel;
    this.scrambleFrame = SCRAMBLE_FRAMES;
    this.confirmedBandIndex = HOME_BAND_INDEX;
    this.confirmedX = x;
    this.lastControllerX = x;
    this.lastControllerY = y;
    this.movementInProgress = false;
    this.stopFrames = POINT_STOP_FRAMES;
  }

  snapTo(x, y) {
    this.resetToHome(x, y);
  }

  startLabelTransition(nextLabel, forceRestart) {
    if (!forceRestart && nextLabel === this.targetLabel) {
      return;
    }

    this.targetLabel = nextLabel;
    this.transitionStartLabel = this.displayLabel;
    this.targetLabelWidth = measureLabelWidth(nextLabel);
    this.scrambleFrame = 0;
  }

  setDisplayLabel(nextLabel) {
    if (nextLabel === this.displayLabel) {
      return;
    }

    this.displayLabel = nextLabel;
    this.displayMetrics = getLabelMetrics(nextLabel);
  }

  updateLabelDisplay() {
    const bandTransitionInProgress =
      this.movementInProgress && this.bandIndex !== this.confirmedBandIndex;

    if (bandTransitionInProgress) {
      this.movementRollFrame += 1;
      this.setDisplayLabel(
        rollingLabelWhileMoving(this.committedLabel, this.movementRollFrame),
      );
      return;
    }

    if (this.displayLabel === this.targetLabel && this.scrambleFrame >= SCRAMBLE_FRAMES) {
      return;
    }

    this.scrambleFrame += 1;

    if (this.scrambleFrame >= SCRAMBLE_FRAMES) {
      this.setDisplayLabel(this.targetLabel);
      return;
    }

    this.setDisplayLabel(
      rollingLabelForTarget(
        this.transitionStartLabel,
        this.targetLabel,
        this.scrambleFrame,
      ),
    );
  }

  updateFromController() {
    const controllerX = this.controller.x();
    const controllerY = this.controller.y();
    const sourceBand = bandIndexForY(controllerY);
    const liveLabel = bandConfigForIndex(sourceBand).label;

    if (mergedWordState.justDeactivated) {
      this.movementInProgress = true;
      this.stopFrames = 0;
      this.movementRollFrame = 0;
    }

    this.updateLandingConfirmation(
      controllerX,
      controllerY,
      sourceBand,
      liveLabel,
    );

    if (!mergedWordState.active && !this.movementInProgress) {
      const settledLabel = bandConfigForIndex(this.confirmedBandIndex).label;
      if (this.committedLabel !== settledLabel) {
        this.committedLabel = settledLabel;
        this.startLabelTransition(settledLabel, true);
      }
    }

    const previewBandIndex = this.movementInProgress
      ? sourceBand
      : this.confirmedBandIndex;
    const previewLabel = this.committedLabel;
    const previewX = this.movementInProgress
      ? this.constrainedX(controllerX, previewLabel)
      : this.constrainedX(this.confirmedX, previewLabel);
    const previewY = this.movementInProgress
      ? controllerY
      : bandCenterY(this.confirmedBandIndex);

    this.bandIndex = previewBandIndex;
    if (!this.movementInProgress || previewBandIndex === this.confirmedBandIndex) {
      this.movementRollFrame = 0;
    }
    this.startLabelTransition(previewLabel, false);
    this.targetX = previewX;
    this.targetY = previewY;
    this.x = lerp(this.x, this.targetX, BAND_X_EASING);
    this.y = lerp(this.y, this.targetY, BAND_Y_EASING);
    this.updateLabelDisplay();
  }

  snapVisualToController() {
    const label = this.committedLabel;
    this.x = this.constrainedX(this.controller.x(), label);
    this.y = this.controller.y();
    this.targetX = this.x;
    this.targetY = this.y;
  }

  updateLandingConfirmation(controllerX, controllerY, bandIndex, label) {
    const dx = controllerX - this.lastControllerX;
    const dy = controllerY - this.lastControllerY;
    const moveStartDistanceSq =
      POINT_MOVE_START_DISTANCE * POINT_MOVE_START_DISTANCE;
    const stopDistanceSq = POINT_STOP_DISTANCE * POINT_STOP_DISTANCE;
    const deltaSq = dx * dx + dy * dy;

    if (deltaSq >= moveStartDistanceSq) {
      if (!this.movementInProgress) {
        this.movementRollFrame = 0;
      }
      this.movementInProgress = true;
      this.stopFrames = 0;
    } else if (this.movementInProgress) {
      if (deltaSq <= stopDistanceSq) {
        this.stopFrames = min(this.stopFrames + 1, POINT_STOP_FRAMES);
      } else {
        this.stopFrames = 0;
      }

      if (this.stopFrames >= POINT_STOP_FRAMES) {
        this.confirmedBandIndex = bandIndex;
        this.committedLabel = label;
        this.confirmedX = this.constrainedX(controllerX, label);
        this.movementInProgress = false;
        this.movementRollFrame = 0;
        this.startLabelTransition(label, true);
      }
    }

    this.lastControllerX = controllerX;
    this.lastControllerY = controllerY;
  }

  confirmedNormalizedX() {
    const label = bandConfigForIndex(this.confirmedBandIndex).label;
    const labelWidth = measureLabelWidth(label);
    const halfWidth = labelWidth * 0.5;
    const minX = HORIZONTAL_MARGIN + halfWidth;
    const maxX = width - HORIZONTAL_MARGIN - halfWidth;
    return constrain(map(this.confirmedX, minX, maxX, 0, 1), 0, 1);
  }

  constrainedX(nextX, label) {
    const labelWidth =
      label === this.targetLabel ? this.targetLabelWidth : measureLabelWidth(label);
    const halfWidth = labelWidth * 0.5;
    return constrain(nextX, HORIZONTAL_MARGIN + halfWidth, width - HORIZONTAL_MARGIN - halfWidth);
  }

  bounds() {
    return centeredMetricsBounds(this.displayMetrics, this.x, this.y);
  }

  draw() {
    push();
    noStroke();
    fill(TEXT_COLOR);
    drawLabelText(this.displayLabel, this.x, this.y, this.displayMetrics);
    pop();
  }
}

class Flock {
  constructor(count, anchor) {
    this.boids = [];
    this.activeCount = 1;

    for (let i = 0; i < count; i += 1) {
      const boid = new Boid(anchor.x, anchor.y);
      boid.deactivate(anchor);
      this.boids.push(boid);
    }

    this.boids[0].activateAt(anchor);
  }

  syncActiveCount(targetCount, anchor) {
    if (this.activeCount < targetCount) {
      const addsThisFrame = min(BOIDS_PER_FRAME_IN, targetCount - this.activeCount);

      for (let i = 0; i < addsThisFrame; i += 1) {
        const boid = this.boids[this.activeCount];
        const spawnData = edgeSpawnData(anchor);
        boid.activateFromEdge(spawnData.x, spawnData.y, spawnData.velocity);
        this.activeCount += 1;
      }
    }

    if (this.activeCount > targetCount) {
      const removalsThisFrame = min(BOIDS_PER_FRAME_OUT, this.activeCount - targetCount);

      for (let i = 0; i < removalsThisFrame; i += 1) {
        this.activeCount -= 1;
        this.boids[this.activeCount].deactivate(anchor);
      }
    }

    if (targetCount === 1) {
      this.boids[0].ensureLeader(anchor);
    }
  }

  run(settings, targetCount, anchor) {
    this.syncActiveCount(targetCount, anchor);

    for (let i = 0; i < this.boids.length; i += 1) {
      const isActive = i < this.activeCount;
      const leaderMode = this.activeCount === 1 && i === 0;
      this.boids[i].run(this.boids, this.activeCount, settings, isActive, leaderMode, anchor);
    }
  }
}

class Boid {
  constructor(x, y) {
    this.location = createVector(x, y);
    this.velocity = createVector(0, 0);
    this.acceleration = createVector(0, 0);
    this.separationForce = createVector(0, 0);
    this.alignmentForce = createVector(0, 0);
    this.cohesionForce = createVector(0, 0);
    this.seekForce = createVector(0, 0);
    this.anchorForce = createVector(0, 0);
    this.wanderTarget = createVector(x, y);
    this.wanderFrames = 0;
    this.r = 2;
    this.entryFrames = 0;
    this.entrySpeedFloor = 0;
    this.flashFrames = 0;
    this.flashCooldownFrames = 0;
    this.flashColor = null;
    this.previousNeighborCount = 0;
    this.previousSeparationPressure = 0;
    this.previousAlignmentScore = 0;
    this.clusterFlashArmed = true;
    this.separationFlashArmed = true;
    this.alignmentFlashArmed = true;
    this.entryDirection = createVector(0, 0);
  }

  activateAt(anchor) {
    this.location.set(anchor.x, anchor.y);
    this.velocity.set(0, 0);
    this.acceleration.set(0, 0);
    this.wanderTarget.set(anchor.x, anchor.y);
    this.wanderFrames = 0;
    this.entryFrames = 0;
    this.entrySpeedFloor = 0;
    this.entryDirection.set(0, 0);
    this.clearFlash();
  }

  activateFromEdge(x, y, velocity) {
    this.location.set(x, y);
    this.velocity.set(velocity.x, velocity.y);
    this.acceleration.set(0, 0);
    this.wanderTarget.set(x, y);
    this.wanderFrames = 0;
    this.entryFrames = ENTRY_TRANSITION_FRAMES;
    this.entrySpeedFloor = velocity.mag();
    if (this.entrySpeedFloor > 0) {
      this.entryDirection.set(
        velocity.x / this.entrySpeedFloor,
        velocity.y / this.entrySpeedFloor,
      );
    } else {
      this.entryDirection.set(0, 0);
    }
    this.clearFlash();
  }

  deactivate(anchor) {
    this.location.set(anchor.x, anchor.y);
    this.velocity.set(0, 0);
    this.acceleration.set(0, 0);
    this.wanderTarget.set(anchor.x, anchor.y);
    this.wanderFrames = 0;
    this.entryFrames = 0;
    this.entrySpeedFloor = 0;
    this.entryDirection.set(0, 0);
    this.clearFlash();
  }

  ensureLeader(anchor) {
    const dx = this.location.x - anchor.x;
    const dy = this.location.y - anchor.y;

    if (dx * dx + dy * dy > 19600) {
      this.location.set(anchor.x, anchor.y);
      this.velocity.mult(0);
      this.acceleration.mult(0);
    }
  }

  run(boids, activeCount, settings, isActive, leaderMode, anchor) {
    if (!isActive) {
      this.render(0);
      return;
    }

    if (leaderMode && settings.dotAnchor) {
      this.setArriveForce(
        this.anchorForce,
        settings.dotAnchor.x,
        settings.dotAnchor.y,
        max(settings.maxSpeed, 10.5),
        max(settings.maxForce, 0.95),
        36,
      );
      this.applyForce(this.anchorForce);
      this.update({
        maxSpeed: max(settings.maxSpeed, 10.5),
      });
      this.velocity.mult(0.985);

      const dx = this.location.x - settings.dotAnchor.x;
      const dy = this.location.y - settings.dotAnchor.y;
      if (dx * dx + dy * dy < 2.56) {
        this.location.set(settings.dotAnchor.x, settings.dotAnchor.y);
        this.velocity.mult(0);
        this.acceleration.mult(0);
        this.clearFlash();
      }

      this.render(PARTICLE_ALPHA);
      return;
    }

    this.flock(boids, activeCount, settings);
    this.update(settings);
    this.borders(anchor);
    this.render(PARTICLE_ALPHA);
  }

  applyForce(force) {
    this.acceleration.add(force);
  }

  flock(boids, activeCount, settings) {
    const behaviorScale = this.entryBehaviorScale();
    const neighborDistance = 50;
    const neighborDistanceSq = neighborDistance * neighborDistance;
    const separationDistance = 25;
    const separationDistanceSq = separationDistance * separationDistance;
    const selfX = this.location.x;
    const selfY = this.location.y;
    const selfVelocityX = this.velocity.x;
    const selfVelocityY = this.velocity.y;
    const selfSpeedSq =
      selfVelocityX * selfVelocityX + selfVelocityY * selfVelocityY;
    const selfInvSpeed =
      selfSpeedSq > 0.0001 ? 1 / sqrt(selfSpeedSq) : 0;
    let neighborCount = 0;
    let separationPressure = 0;
    let alignmentScoreSum = 0;
    let alignmentSamples = 0;
    let separationX = 0;
    let separationY = 0;
    let separationCount = 0;
    let alignmentX = 0;
    let alignmentY = 0;
    let cohesionX = 0;
    let cohesionY = 0;

    for (let i = 0; i < activeCount; i += 1) {
      const other = boids[i];
      if (other === this) {
        continue;
      }

      const dx = selfX - other.location.x;
      const dy = selfY - other.location.y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= 0) {
        continue;
      }

      if (distSq < neighborDistanceSq) {
        neighborCount += 1;
        alignmentX += other.velocity.x;
        alignmentY += other.velocity.y;
        cohesionX += other.location.x;
        cohesionY += other.location.y;

        if (selfInvSpeed > 0) {
          const otherSpeedSq =
            other.velocity.x * other.velocity.x +
            other.velocity.y * other.velocity.y;
          if (otherSpeedSq > 0.0001) {
            alignmentScoreSum +=
              (selfVelocityX * other.velocity.x +
                selfVelocityY * other.velocity.y) *
              selfInvSpeed /
              sqrt(otherSpeedSq);
            alignmentSamples += 1;
          }
        }
      }

      if (distSq < separationDistanceSq) {
        const distance = sqrt(distSq);
        separationPressure += 1 - distance / separationDistance;
        separationX += dx / distSq;
        separationY += dy / distSq;
        separationCount += 1;
      }
    }

    const alignmentScore =
      alignmentSamples > 0 ? alignmentScoreSum / alignmentSamples : 0;

    if (neighborCount <= 2) {
      this.clusterFlashArmed = true;
    }
    if (separationPressure <= 0.4) {
      this.separationFlashArmed = true;
    }
    if (neighborCount < 3 || alignmentScore <= 0.35) {
      this.alignmentFlashArmed = true;
    }

    const clusterFormed =
      this.clusterFlashArmed &&
      neighborCount >= 6 &&
      this.previousNeighborCount < 6;
    const separationSpike =
      this.separationFlashArmed &&
      separationPressure >= 1.35 &&
      this.previousSeparationPressure < 1.35;
    const alignmentSurge =
      this.alignmentFlashArmed &&
      neighborCount >= 4 &&
      alignmentScore >= 0.82 &&
      this.previousAlignmentScore < 0.82;

    this.previousNeighborCount = neighborCount;
    this.previousSeparationPressure = separationPressure;
    this.previousAlignmentScore = alignmentScore;

    if (separationCount > 0) {
      separationX /= separationCount;
      separationY /= separationCount;
    }

    this.setSteerFromDesired(
      this.separationForce,
      separationX,
      separationY,
      settings.maxSpeed,
      settings.maxForce,
    );

    if (neighborCount > 0) {
      this.setSteerFromDesired(
        this.alignmentForce,
        alignmentX / neighborCount,
        alignmentY / neighborCount,
        settings.maxSpeed,
        settings.maxForce,
      );
      this.setSeekForce(
        this.cohesionForce,
        cohesionX / neighborCount,
        cohesionY / neighborCount,
        settings.maxSpeed,
        settings.maxForce,
      );
    } else {
      this.alignmentForce.set(0, 0);
      this.cohesionForce.set(0, 0);
    }

    this.updateWanderTarget();
    this.setSeekForce(
      this.seekForce,
      this.wanderTarget.x,
      this.wanderTarget.y,
      settings.maxSpeed,
      settings.maxForce,
    );

    this.separationForce.mult(settings.separation * behaviorScale);
    this.alignmentForce.mult(settings.alignment * behaviorScale);
    this.cohesionForce.mult(
      map(settings.separation, 0, 15, 15, 0) * behaviorScale,
    );
    this.seekForce.mult(settings.seek * behaviorScale);

    this.applyForce(this.separationForce);
    this.applyForce(this.alignmentForce);
    this.applyForce(this.cohesionForce);
    this.applyForce(this.seekForce);

    if (this.flashCooldownFrames === 0) {
      if (clusterFormed) {
        this.clusterFlashArmed = false;
        this.triggerFlash(randomFlashColor());
      } else if (separationSpike) {
        this.separationFlashArmed = false;
        this.triggerFlash(randomFlashColor());
      } else if (alignmentSurge) {
        this.alignmentFlashArmed = false;
        this.triggerFlash(randomFlashColor());
      }
    }
  }

  update(settings) {
    if (this.entryFrames > 0 && this.entryDirection.magSq() > 0) {
      this.velocity.x += this.entryDirection.x * ENTRY_THRUST;
      this.velocity.y += this.entryDirection.y * ENTRY_THRUST;
    }

    this.velocity.add(this.acceleration);
    this.velocity.limit(this.effectiveMaxSpeed(settings.maxSpeed));
    this.location.add(this.velocity);
    this.acceleration.mult(0);

    if (this.entryFrames > 0) {
      this.entryFrames -= 1;
    }

    if (this.flashFrames > 0) {
      this.flashFrames -= 1;
      if (this.flashFrames === 0) {
        this.flashColor = null;
      }
    }

    if (this.flashCooldownFrames > 0) {
      this.flashCooldownFrames -= 1;
    }
  }

  effectiveMaxSpeed(baseMaxSpeed) {
    if (this.entryFrames <= 0) {
      return baseMaxSpeed;
    }

    const progress = 1 - this.entryFrames / ENTRY_TRANSITION_FRAMES;
    const boostedSpeed = max(this.entrySpeedFloor * 1.18, baseMaxSpeed);
    return lerp(boostedSpeed, baseMaxSpeed, pow(progress, 3.2));
  }

  entryBehaviorScale() {
    if (this.entryFrames <= 0) {
      return 1;
    }

    const progress = 1 - this.entryFrames / ENTRY_TRANSITION_FRAMES;
    return lerp(ENTRY_BEHAVIOR_FLOOR, 1, pow(progress, 1.8));
  }

  updateWanderTarget() {
    if (this.wanderFrames <= 0) {
      this.wanderTarget.set(random(width), random(height));
      this.wanderFrames = WANDER_TARGET_HOLD_FRAMES;
      return;
    }

    this.wanderFrames -= 1;
  }

  setSteerFromDesired(out, desiredX, desiredY, maxSpeed, maxForce) {
    const desiredMagSq = desiredX * desiredX + desiredY * desiredY;

    if (desiredMagSq === 0) {
      out.set(0, 0);
      return out;
    }

    const desiredScale = maxSpeed / sqrt(desiredMagSq);
    out.set(
      desiredX * desiredScale - this.velocity.x,
      desiredY * desiredScale - this.velocity.y,
    );
    out.limit(maxForce);
    return out;
  }

  setSeekForce(out, targetX, targetY, maxSpeed, maxForce) {
    return this.setSteerFromDesired(
      out,
      targetX - this.location.x,
      targetY - this.location.y,
      maxSpeed,
      maxForce,
    );
  }

  setArriveForce(out, targetX, targetY, maxSpeed, maxForce, slowRadius) {
    const desiredX = targetX - this.location.x;
    const desiredY = targetY - this.location.y;
    const distanceSq = desiredX * desiredX + desiredY * desiredY;

    if (distanceSq === 0) {
      out.set(0, 0);
      return out;
    }

    const distance = sqrt(distanceSq);
    const desiredSpeed =
      distance < slowRadius
        ? maxSpeed * pow(distance / slowRadius, 0.35)
        : maxSpeed;
    const desiredScale = desiredSpeed / distance;

    out.set(
      desiredX * desiredScale - this.velocity.x,
      desiredY * desiredScale - this.velocity.y,
    );
    out.limit(maxForce);
    return out;
  }

  render(alphaValue) {
    const pulse = this.flashFrames
      ? 0.45 + 0.55 * abs(sin((FLASH_DURATION_FRAMES - this.flashFrames) * 0.9))
      : 1;
    const strokeColor = this.flashColor || [255, 255, 255];

    stroke(
      strokeColor[0],
      strokeColor[1],
      strokeColor[2],
      alphaValue * pulse,
    );
    strokeWeight(DOT_PARTICLE_WEIGHT);
    noFill();
    point(this.location.x, this.location.y);
  }

  borders(anchor) {
    let wrapped = false;

    if (this.location.x < -this.r) {
      this.location.x = width + this.r;
      wrapped = true;
    }
    if (this.location.y < -this.r) {
      this.location.y = height + this.r;
      wrapped = true;
    }
    if (this.location.x > width + this.r) {
      this.location.x = -this.r;
      wrapped = true;
    }
    if (this.location.y > height + this.r) {
      this.location.y = -this.r;
      wrapped = true;
    }

    if (wrapped && anchor) {
      this.clearFlash();
    }
  }

  clearFlash() {
    this.flashFrames = 0;
    this.flashCooldownFrames = 0;
    this.flashColor = null;
  }

  triggerFlash(colorValue) {
    this.flashFrames = FLASH_DURATION_FRAMES;
    this.flashCooldownFrames = FLASH_COOLDOWN_FRAMES;
    this.flashColor = colorValue || randomFlashColor();
  }
}
