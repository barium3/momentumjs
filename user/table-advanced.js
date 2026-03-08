let table;

function preload() {
  table = loadTable("sample-data.csv", "csv", "header");
}

function setup() {
  createCanvas(900, 520);
  background(245);
  fill(30);
  noStroke();

  textSize(24);
  text("Table Advanced Test", 40, 40);

  textSize(14);
  text("rows: " + table.getRowCount(), 40, 80);
  text("columns: " + table.getColumnCount(), 40, 105);

  let row1 = table.getRow(1);
  let foundCircle = table.findRow("CircleB", "name");
  let visibleRows = table.findRows("true", "visible");
  let matchLabel = table.matchRow("Lab", "name");
  let matchCircles = table.matchRows("^Circle", "name");

  textSize(18);
  text("getRow()", 40, 155);
  textSize(14);
  text(
    "row 2 -> id=" +
      row1.getString("id") +
      ", name=" +
      row1.getString("name") +
      ", x=" +
      row1.getNum("x"),
    40,
    182,
  );

  textSize(18);
  text("findRow()", 40, 225);
  textSize(14);
  text(
    foundCircle
      ? "CircleB -> y=" +
          foundCircle.getString("y") +
          ", color=" +
          foundCircle.getString("color")
      : "CircleB not found",
    40,
    252,
  );

  textSize(18);
  text("findRows()", 40, 295);
  textSize(14);
  text("visible=true count: " + visibleRows.length, 40, 322);
  for (let i = 0; i < visibleRows.length; i++) {
    text(
      visibleRows[i].getString("id") +
        " | " +
        visibleRows[i].getString("name") +
        " | visible=" +
        visibleRows[i].getString("visible"),
      40,
      346 + i * 22,
    );
  }

  textSize(18);
  text("matchRow / matchRows", 480, 155);
  textSize(14);
  text(
    matchLabel
      ? "match 'Lab' -> " + matchLabel.getString("name")
      : "match 'Lab' -> none",
    480,
    182,
  );
  text("match '^Circle' count: " + matchCircles.length, 480, 207);
  for (let j = 0; j < matchCircles.length; j++) {
    text(
      matchCircles[j].getString("id") +
        " | " +
        matchCircles[j].getString("name") +
        " | x=" +
        matchCircles[j].getString("x"),
      480,
      231 + j * 22,
    );
  }
}
