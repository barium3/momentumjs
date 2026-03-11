let table;

function preload() {
  table = loadTable("sample-data.csv", "csv", "header");
}

function setup() {
  createCanvas(980, 560);
  background(245);
  fill(30);
  noStroke();

  table.setNum(0, "x", 999);
  table.setString(0, "name", "Retitled");

  let newRow = table.addRow();
  newRow.setString("id", "6");
  newRow.setString("name", "NewRow");
  newRow.setNum("x", 720);
  newRow.setNum("y", 420);
  newRow.setString("visible", "true");
  newRow.setString("color", "#00A896");

  table.addColumn("tag");
  for (let i = 0; i < table.getRowCount(); i++) {
    table.setString(i, "tag", "");
  }
  table.setString(0, "tag", "hero");
  newRow.setString("tag", "fresh");

  table.removeRow(3);
  table.removeColumn("rotation");

  textSize(24);
  text("Table Mutate Test", 40, 40);

  textSize(14);
  text("rows: " + table.getRowCount(), 40, 80);
  text("columns: " + table.getColumnCount(), 40, 105);
  text("row1 name: " + table.getString(0, "name"), 40, 130);
  text("row1 x: " + table.getNum(0, "x"), 40, 155);
  text("new row tag: " + table.findRow("NewRow", "name").getString("tag"), 40, 180);
  text("has rotation column: " + (table.columns.indexOf("rotation") !== -1 ? "yes" : "no"), 40, 205);

  textSize(20);
  text("Preview", 40, 250);
  textSize(14);

  for (let i = 0; i < table.getRowCount(); i++) {
    let row = table.getRow(i);
    text(
      row.getString("id") +
        " | " +
        row.getString("name") +
        " | x=" +
        row.getString("x") +
        " | y=" +
        row.getString("y") +
        " | tag=" +
        row.getString("tag"),
      40,
      280 + i * 24,
    );
  }
}
