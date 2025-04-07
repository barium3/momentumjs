#target "aftereffects";
var m = {};

(function(pub, app, undef) {

  pub.VERSION = "0.0.1";

  // Core includes
  #include "includes/constants.js"
  #include "includes/private-vars.js"
  #include "includes/core.js"

  // Feature modules
  #include "includes/shape.js"
  #include "includes/typography.js"
  #include "includes/color.js"
  #include "includes/transformation.js"
  #include "includes/math.js"
  #include "includes/controller.js"
  #include "includes/image.js"
  #include "includes/environment.js"
  #include "includes/data.js"
  #include "includes/keyframe.js"

  $.global.m = pub;
})(m, app); 