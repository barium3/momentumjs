# API Reference

This page is the main entry point for the Momentum API reference.

Use it to quickly navigate to the documentation for each API category.

---

- [Shapes](shapes.md)
  `ellipse`, `circle`, `rect`, `square`, `line`, `point`, `triangle`, `quad`, `arc`, `ellipseMode`, `rectMode`, `beginShape`, `vertex`, `bezierVertex`, `quadraticVertex`, `curveVertex`, `beginContour`, `endContour`, `endShape`
- [Transform](transform.md)
  `translate`, `rotate`, `scale`, `applyMatrix`, `shearX`, `shearY`, `push`, `pop`, `resetMatrix`
- [Color](color.md)
  `background`, `clear`, `fill`, `noFill`, `stroke`, `noStroke`, `strokeWeight`, `strokeCap`, `strokeJoin`, `blendMode`, `erase`, `noErase`, `color`, `lerpColor`, `colorMode`, `red`, `green`, `blue`, `alpha`, `hue`, `saturation`, `brightness`, `lightness`
- [Typography](typography.md)
  `text`, `textSize`, `textLeading`, `textFont`, `textStyle`, `textWrap`, `textAlign`, `textWidth`, `textAscent`, `textDescent`, `loadFont`, `Font.textBounds`, `Font.textToPoints`
- [Image](image.md)
  `loadImage`, `image`, `imageMode`, `tint`, `noTint`, `createGraphics`, `createImage`, `pixelDensity`, `loadPixels`, `updatePixels`, `pixels`, `get`, `set`, `copy`, `blend`, `filter`, `Image.pixelDensity`, `Image.loadPixels`, `Image.updatePixels`, `Image.get`, `Image.set`, `Image.copy`, `Image.blend`, `Image.filter`, `Image.resize`, `Image.mask`
- [Data](data.md)
  `append`, `arrayCopy`, `concat`, `reverse`, `shorten`, `shuffle`, `sort`, `splice`, `subset`, `join`, `split`, `splitTokens`, `trim`, `match`, `matchAll`, `nf`, `nfc`, `nfp`, `nfs`, `str`, `boolean`, `byte`, `char`, `float`, `hex`, `int`, `unchar`, `unhex`, `print`
- [IO](io.md)
  `loadTable`, `loadJSON`, `loadStrings`, `loadBytes`, `loadXML`, `Table.getRowCount`, `Table.getColumnCount`, `Table.get`, `Table.getRow`, `Table.getString`, `Table.getNum`, `Table.getColumn`, `Table.getObject`, `Table.getArray`, `Table.findRow`, `Table.findRows`, `Table.matchRow`, `Table.matchRows`, `Table.set`, `Table.setString`, `Table.setNum`, `Table.addRow`, `Table.removeRow`, `Table.clearRows`, `Table.addColumn`, `Table.removeColumn`, `TableRow.arr`, `TableRow.obj`, `TableRow.get`, `TableRow.getString`, `TableRow.getNum`, `TableRow.set`, `TableRow.setString`, `TableRow.setNum`, `XML.getParent`, `XML.getName`, `XML.getChildren`, `XML.getContent`, `XML.serialize`
- [Environment](environment.md)
  `createCanvas`, `frameRate`, `duration`, `pixelDensity`, `isLooping`, `loop`, `noLoop`, `redraw`, `width`, `height`, `frameCount`
- [Math](math.md)
  `PI`, `TWO_PI`, `HALF_PI`, `QUARTER_PI`, `DEGREES`, `RADIANS`, `CENTER`, `RADIUS`, `CORNER`, `CORNERS`, `OPEN`, `CHORD`, `PIE`, `CLOSE`, `LEFT`, `RIGHT`, `TOP`, `BOTTOM`, `BASELINE`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `degrees`, `radians`, `angleMode`, `sqrt`, `pow`, `abs`, `floor`, `ceil`, `round`, `min`, `max`, `exp`, `log`, `sq`, `fract`, `norm`, `mag`, `map`, `constrain`, `lerp`, `dist`, `random`, `randomGaussian`, `randomSeed`, `noise`, `noiseDetail`, `noiseSeed`, `bezierPoint`, `bezierTangent`, `curvePoint`, `curveTangent`, `curveTightness`, `createVector`
- [Controllers](controllers.md)
  `createSlider`, `createAngle`, `createColorPicker`, `createCheckbox`, `createSelect`, `createPoint`

---

## Notes

- API behavior is designed to feel close to p5.js where possible.
- Some APIs are Momentum-specific because they map to After Effects concepts and limitations.
- Several pages call out Bitmap-only features directly in the relevant function sections instead of listing those differences here.
- When behavior differs from p5.js, the Momentum documentation should be treated as the source of truth.
