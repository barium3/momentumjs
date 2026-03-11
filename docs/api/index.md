# API Reference

This page is the main entry point for the Momentum API reference.

Use it to quickly navigate to the documentation for each API category.

---

- [Shapes](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/shapes.md)
  `ellipse`, `circle`, `rect`, `square`, `line`, `point`, `triangle`, `quad`, `arc`, `beginShape`, `vertex`, `bezierVertex`, `quadraticVertex`, `curveVertex`, `beginContour`, `endContour`, `endShape`
- [Transform](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/transform.md)
  `translate`, `rotate`, `scale`, `push`, `pop`, `resetMatrix`
- [Color](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/color.md)
  `background`, `fill`, `noFill`, `stroke`, `noStroke`, `strokeWeight`, `color`, `lerpColor`, `colorMode`, `red`, `green`, `blue`, `alpha`, `hue`, `saturation`, `brightness`, `lightness`
- [Typography](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/typography.md)
  `text`, `textSize`, `textLeading`, `textFont`, `textStyle`, `textWrap`, `textAlign`, `textWidth`, `textAscent`, `textDescent`
- [Image](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/image.md)
  `loadImage`, `image`, `imageMode`, `tint`, `noTint`, `img.get`, `img.resize`

- [Data](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/data.md)
  `append`, `arrayCopy`, `concat`, `reverse`, `shorten`, `shuffle`, `sort`, `splice`, `subset`, `join`, `split`, `splitTokens`, `trim`, `match`, `matchAll`, `nf`, `nfc`, `nfp`, `nfs`, `str`, `boolean`, `byte`, `char`, `float`, `hex`, `int`, `unchar`, `unhex`, `print`
- [IO](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/io.md)
  `loadTable`, `loadJSON`, `Table.getRowCount`, `Table.getColumnCount`, `Table.get`, `Table.getRow`, `Table.getString`, `Table.getNum`, `Table.getColumn`, `Table.getObject`, `Table.getArray`, `Table.findRow`, `Table.findRows`, `Table.matchRow`, `Table.matchRows`, `Table.set`, `Table.setString`, `Table.setNum`, `Table.addRow`, `Table.removeRow`, `Table.clearRows`, `Table.addColumn`, `Table.removeColumn`, `TableRow.arr`, `TableRow.obj`, `TableRow.get`, `TableRow.getString`, `TableRow.getNum`, `TableRow.set`, `TableRow.setString`, `TableRow.setNum`

- [Environment](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/environment.md)
  `createCanvas`, `frameRate`, `duration`, `isLooping`, `loop`, `noLoop`, `redraw`, `width`, `height`, `frameCount`
- [Math](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/math.md)
  `PI`, `TWO_PI`, `HALF_PI`, `QUARTER_PI`, `DEGREES`, `RADIANS`, `CENTER`, `RADIUS`, `CORNER`, `CORNERS`, `OPEN`, `CHORD`, `PIE`, `CLOSE`, `LEFT`, `RIGHT`, `TOP`, `BOTTOM`, `BASELINE`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `degrees`, `radians`, `angleMode`, `sqrt`, `pow`, `abs`, `floor`, `ceil`, `round`, `min`, `max`, `exp`, `log`, `sq`, `fract`, `norm`, `mag`, `map`, `constrain`, `lerp`, `dist`, `random`, `randomGaussian`, `randomSeed`, `noise`, `noiseDetail`, `noiseSeed`, `bezierPoint`, `bezierTangent`, `curvePoint`, `curveTangent`, `curveTightness`, `createVector`

- [Controllers](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/controllers.md)
  `createSlider`, `createAngle`, `createColorPicker`, `createCheckbox`, `createSelect`, `createPoint`, `createPathController`

---

## Notes

- API behavior is designed to feel close to p5.js where possible.
- Some APIs are Momentum-specific because they map to After Effects concepts and limitations.
- When behavior differs from p5.js, the Momentum documentation should be treated as the source of truth.
