#target "aftereffects";

(function(glob, app, undef) {

  var pub = {};

  pub.VERSION = "0.0.1";

  // #include "includes/constants.js";
  #include "includes/private-vars.js";

  #include "includes/core.js";

  #include "includes/test.js";
  #include "includes/shape.js";
  
  init();

})(this, app);