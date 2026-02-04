#target "aftereffects";
var m = {};

(function(pub, app, undef) {

  pub.VERSION = "1.0.0";

  // Core includes

  #include "includes/registry.js"

  // Processing-style modules (must be before core.js)
  #include "includes/math.js"
  #include "includes/transformation.js"
  #include "includes/color.js"
  #include "includes/shape.js"
  #include "includes/environment.js"
  #include "includes/structure.js"
  #include "includes/core.js"


  $.global.m = pub;
})(m, app); 