// @filename: conversion-helper-functions-test
// p5 Data conversion helper functions smoke test

function setup() {
  createCanvas(860, 260);
  background(245);
  fill(20);
  textSize(16);
  noLoop();

  var lines = [
    "boolean('1'): " + boolean("1"),
    "byte(255): " + byte(255),
    "char(65): " + char(65),
    "float('3.14'): " + float("3.14"),
    "hex(255): " + hex(255),
    "int('42.9'): " + int("42.9"),
    "str(123): " + str(123),
    "unchar('A'): " + unchar("A"),
    "unhex('FF'): " + unhex("FF"),
    "int(['1','2']): " + int(["1", "2"]).join(", "),
    "hex([15,255], 2): " + hex([15, 255], 2).join(", "),
  ];

  for (var i = 0; i < lines.length; i++) {
    text(lines[i], 24, 32 + i * 20);
  }
}
