let table;

function preload() {
  table = loadTable("sample-data.csv", "csv", "header");
}

function setup() {
  createCanvas(720, 420);
  background(245);

  fill(30);
  noStroke();
  textSize(20);
  text("loadTable() Test", 40, 40);

  textSize(14);
  text("rows: " + table.getRowCount(), 40, 80);
  text("columns: " + table.getColumnCount(), 40, 105);
  text("first name: " + table.getString(0, "name"), 40, 130);
  text("second x: " + table.getNum(1, "x"), 40, 155);
  text("third color: " + table.getString(2, "color"), 40, 180);

  textSize(16);
  text("Row Preview", 40, 230);

  textSize(12);
  for (let i = 0; i < table.getRowCount(); i++) {
    let rowText =
      table.getString(i, "id") +
      " | " +
      table.getString(i, "name") +
      " | x=" +
      table.getString(i, "x") +
      " | y=" +
      table.getString(i, "y") +
      " | visible=" +
      table.getString(i, "visible");
    text(rowText, 40, 260 + i * 24);
  }
}
