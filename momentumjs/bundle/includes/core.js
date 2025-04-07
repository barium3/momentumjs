error = pub.error = function (msg) {
  // println(ERROR_PREFIX + msg);
  throw new Error(ERROR_PREFIX + msg);
};
