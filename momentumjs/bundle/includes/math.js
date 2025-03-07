pub.lerp = function (start, stop, amt) {
  return amt * (stop - start) + start;
};

pub.map = function (value, start1, stop1, start2, stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
};

pub.add = function (pos1, pos2) {
  var maxLength = Math.max(pos1.length, pos2.length);
  var result = [];
  for (var i = 0; i < maxLength; i++) {
    var val1 = pos1[i] !== undefined ? pos1[i] : 0;
    var val2 = pos2[i] !== undefined ? pos2[i] : 0;
    result.push("add([" + val1 + "], [" + val2 + "])");
  }
  return result;
};

pub.mul = function (scale1, scale2) {
  return "mul(" + scale1 + ", " + scale2 + ")";
};

pub.div = function (num1, num2) {
  if (typeof num1 === "string" && typeof num2 === "string") {
    return "(" + num1 + ") / (" + num2 + ")";
  } else if (typeof num1 === "string" || typeof num2 === "string") {
    return "div(" + num1 + ", " + num2 + ")";
  } else {
    return num1 / num2;
  }
};
