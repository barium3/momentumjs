// @filename: array-helper-functions-test
// p5 Data array helper functions smoke test

function setup() {
  createCanvas(800, 240);
  background(245);
  fill(20);
  textSize(16);
  noLoop();

  var base = [3, 1, 2];
  var appended = append(base.slice(0), 4);
  var copied = [];
  arrayCopy(appended, 1, copied, 0, 2);
  var concatenated = concat(copied, ["A", "B"]);
  var reversed = reverse(concatenated.slice(0));
  var shortened = shorten(reversed.slice(0));
  var shuffled = shuffle([1, 2, 3, 4], false);
  var sorted = sort([9, 4, 7, 1]);
  var spliced = splice([10, 40], [20, 30], 1);
  var sliced = subset(spliced, 1, 2);

  var lines = [
    "append: " + appended.join(", "),
    "arrayCopy: " + copied.join(", "),
    "concat: " + concatenated.join(", "),
    "reverse: " + reversed.join(", "),
    "shorten: " + shortened.join(", "),
    "shuffle: " + shuffled.join(", "),
    "sort: " + sorted.join(", "),
    "splice: " + spliced.join(", "),
    "subset: " + sliced.join(", "),
  ];

  for (var i = 0; i < lines.length; i++) {
    text(lines[i], 24, 32 + i * 22);
  }
}
