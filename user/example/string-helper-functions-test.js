// @filename: string-helper-functions-test
// p5 Data string helper functions smoke test

function setup() {
  createCanvas(920, 320);
  background(245);
  fill(20);
  textSize(16);
  noLoop();

  var lines = [
    "join: " + join(["A", "B", "C"], "-"),
    "match: " + JSON.stringify(match("abc123def", "\\d+")),
    "matchAll: " + JSON.stringify(matchAll("a1 b22 c333", "\\d+")),
    "nf: " + nf(12.3, 4, 2),
    "nfc: " + nfc(1234567.89, 2),
    "nfp: " + nfp(12.3, 3, 1),
    "nfs: " + nfs(12.3, 3, 1),
    "split: " + JSON.stringify(split("A-B-C", "-")),
    "splitTokens: " + JSON.stringify(splitTokens("A, B;C", ", ;")),
    "trim: " + JSON.stringify(trim(["  hi  ", "\\n there\\t"])),
  ];

  for (var i = 0; i < lines.length; i++) {
    text(lines[i], 24, 32 + i * 24);
  }
}
