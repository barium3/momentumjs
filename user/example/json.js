let data;

function preload() {
  data = loadJSON("sample-data.json");
}

function setup() {
  createCanvas(860, 420);
  background(245);
  fill(30);
  noStroke();

  textSize(24);
  text("loadJSON() Test", 40, 40);

  textSize(14);
  text("title: " + data.title, 40, 90);
  text("primary: " + data.theme.primary, 40, 115);
  text("item count: " + data.items.length, 40, 140);
  text("second name: " + data.items[1].name, 40, 165);
  text("third visible: " + data.items[2].visible, 40, 190);

  textSize(20);
  text("Items", 40, 240);

  textSize(14);
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    text(
      item.id +
        " | " +
        item.name +
        " | x=" +
        item.x +
        " | y=" +
        item.y +
        " | visible=" +
        item.visible,
      40,
      270 + i * 24,
    );
  }
}
