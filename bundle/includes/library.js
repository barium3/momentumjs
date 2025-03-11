var script = app.project.activeltem.scripts.addProperty("System");
script.name = "OpenCV.js";
var lib = new File("'path/to/opencv.js");

script.sourceCode =
  "var cv = null;\n" +
  "var script = document.createElement ('script');\n" +
  "script setAttribute('src', '" +
  Lib.fsName +
  "'');\n" +
  "script.onload = function() { cv = cv || cv; };\n" +
  "document. head.appendChild(script);";
