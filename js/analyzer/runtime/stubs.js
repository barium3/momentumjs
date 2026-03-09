// Lightweight browser-side stubs for custom Momentum helpers.
(function (window) {
  "use strict";

  function markStub(name) {
    if (!window.__momentumStubs) {
      window.__momentumStubs = {};
    }
    window.__momentumStubs[name] = true;
  }

  function installMomentumStubs(options) {
    options = options || {};
    var mode = options.mode || "execution";

    if (typeof window.duration === "undefined") {
      window.duration = function () {};
      markStub("duration");
    }

    if (typeof window.createPoint === "undefined") {
      window.createPoint = function (defaultX, defaultY) {
        var x = defaultX === undefined ? 0 : defaultX;
        var y = defaultY === undefined ? 0 : defaultY;

        return {
          value: function () {
            return [x, y];
          },
          x: function () {
            return x;
          },
          y: function () {
            return y;
          },
        };
      };
      markStub("createPoint");
    }

    if (typeof window.createAngle === "undefined") {
      window.createAngle = function (defaultDegrees) {
        var deg = defaultDegrees === undefined ? 0 : defaultDegrees;

        return {
          value: function () {
            return deg;
          },
          degrees: function () {
            return deg;
          },
          radians: function () {
            return (deg * Math.PI) / 180;
          },
        };
      };
      markStub("createAngle");
    }

    if (typeof window.createPathController === "undefined") {
      window.createPathController = function (name, points, closed) {
        var defPoints =
          points && points.length >= 2
            ? points
            : [
                [window.width / 3 || 320, window.height / 2 || 240],
                [((window.width || 960) * 2) / 3, window.height / 2 || 240],
              ];
        var defClosed = closed === undefined ? false : !!closed;

        function clamp01(t) {
          if (!(t === t)) return 0;
          if (t < 0) return 0;
          if (t > 1) return 1;
          return t;
        }

        function pointAt(t) {
          var pts = defPoints.slice();
          if (pts.length === 0) return [0, 0];
          if (pts.length === 1) return pts[0];
          if (defClosed && pts.length > 1) pts.push(pts[0]);

          var segLens = [];
          var total = 0;
          for (var i = 0; i < pts.length - 1; i++) {
            var dx = pts[i + 1][0] - pts[i][0];
            var dy = pts[i + 1][1] - pts[i][1];
            var len = Math.sqrt(dx * dx + dy * dy);
            segLens.push(len);
            total += len;
          }
          if (!(total > 0)) return pts[0];

          var target = clamp01(t) * total;
          var acc = 0;
          for (var j = 0; j < segLens.length; j++) {
            var seg = segLens[j];
            if (target <= acc + seg || j === segLens.length - 1) {
              var local = seg > 0 ? (target - acc) / seg : 0;
              return [
                pts[j][0] + (pts[j + 1][0] - pts[j][0]) * local,
                pts[j][1] + (pts[j + 1][1] - pts[j][1]) * local,
              ];
            }
            acc += seg;
          }
          return pts[pts.length - 1];
        }

        function tangentAt(t) {
          var p0 = pointAt(clamp01(t - 0.001));
          var p1 = pointAt(clamp01(t + 0.001));
          var dx = p1[0] - p0[0];
          var dy = p1[1] - p0[1];
          var len = Math.sqrt(dx * dx + dy * dy);
          if (!(len > 0)) return [1, 0];
          return [dx / len, dy / len];
        }

        return {
          exists: function () {
            return true;
          },
          closed: function () {
            return defClosed;
          },
          points: function () {
            return defPoints;
          },
          point: function (t) {
            return pointAt(t);
          },
          tangent: function (t) {
            return tangentAt(t);
          },
          normal: function (t) {
            var tan = tangentAt(t);
            return [-tan[1], tan[0]];
          },
          angle: function (t) {
            var tan = tangentAt(t);
            return (Math.atan2(tan[1], tan[0]) * 180) / Math.PI;
          },
          sample: function (count) {
            var n = Math.max(0, Math.floor(Number(count) || 0));
            var out = [];
            if (n <= 0) return out;
            if (n === 1) return [pointAt(0)];
            for (var i = 0; i < n; i++) {
              out.push(pointAt(i / (n - 1)));
            }
            return out;
          },
        };
      };
      markStub("createPathController");
    }

    if (typeof window.image === "undefined") {
      window.image = function () {};
      markStub("image");
    }

    if (typeof window.imageMode === "undefined") {
      window.imageMode = function () {};
      markStub("imageMode");
    }

    if (typeof window.tint === "undefined") {
      window.tint = function () {};
      markStub("tint");
    }
    if (typeof window.noTint === "undefined") {
      window.noTint = function () {};
      markStub("noTint");
    }

    if (typeof window.preload === "undefined") {
      window.preload = function () {};
      markStub("preload");
    }

    if (mode !== "execution" || typeof window.loadImage === "undefined") {
      window.loadImage = function (path) {
        var varName = path
          .replace(/[^a-zA-Z0-9_]/g, "_")
          .replace(/^(\d)/, "_$1");

        if (
          window.__momentumLoadedImages &&
          window.__momentumLoadedImages[path]
        ) {
          return window.__momentumLoadedImages[path];
        }

        if (window[varName]) {
          return window[varName];
        }

        var img = {
          width: 0,
          height: 0,
          _momentumPath: path,
          _momentumResolvedUrl: null,
          _momentumFullPath: null,
          _momentumReady: false,
          _placeholder: true,
          get: function (x, y, w, h) {
            if (arguments.length >= 4) {
              return {
                width: Math.max(0, Math.floor(Number(w) || 0)),
                height: Math.max(0, Math.floor(Number(h) || 0)),
                _momentumPath: path,
                _momentumResolvedUrl: null,
                _momentumFullPath: null,
                _momentumReady: false,
                _placeholder: true,
                get: function () {
                  return [0, 0, 0, 0];
                },
              };
            }
            return [0, 0, 0, 0];
          },
        };
        return img;
      };
      markStub("loadImage");
    }
  }

  window.installMomentumStubs = installMomentumStubs;
})(window);
