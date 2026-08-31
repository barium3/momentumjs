#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "host/ae_sdk.h"

namespace momentum {

struct ScenePayload;

struct ScalarSpec {
  std::string mode;
  double value = 0.0;
};

struct Transform2D {
  double a = 1.0;
  double b = 0.0;
  double c = 0.0;
  double d = 1.0;
  double tx = 0.0;
  double ty = 0.0;
};

struct VertexSpec {
  ScalarSpec x = {"pixels", 0.0};
  ScalarSpec y = {"pixels", 0.0};
};

enum PathSegmentType {
  PATH_SEGMENT_MOVE_TO = 0,
  PATH_SEGMENT_LINE_TO = 1,
  PATH_SEGMENT_QUADRATIC_TO = 2,
  PATH_SEGMENT_CUBIC_TO = 3,
  PATH_SEGMENT_CLOSE = 4,
};

struct PathSegment {
  int type = PATH_SEGMENT_MOVE_TO;
  VertexSpec point;
  VertexSpec control1;
  VertexSpec control2;
};

struct PathSubpath {
  std::vector<PathSegment> segments;
  bool isContour = false;
};

struct VectorPath {
  std::vector<PathSubpath> subpaths;
};

enum ShapeMode {
  SHAPE_MODE_CORNER = 0,
  SHAPE_MODE_CORNERS = 1,
  SHAPE_MODE_CENTER = 2,
  SHAPE_MODE_RADIUS = 3,
};

enum BeginShapeKind {
  BEGIN_SHAPE_DEFAULT = 0,
  BEGIN_SHAPE_POINTS = 10,
  BEGIN_SHAPE_LINES = 11,
  BEGIN_SHAPE_TRIANGLES = 12,
  BEGIN_SHAPE_TRIANGLE_FAN = 13,
  BEGIN_SHAPE_TRIANGLE_STRIP = 14,
  BEGIN_SHAPE_QUADS = 15,
  BEGIN_SHAPE_QUAD_STRIP = 16,
  BEGIN_SHAPE_TESS = 17,
 };

enum ColorMode {
  COLOR_MODE_RGB = 0,
  COLOR_MODE_HSB = 1,
  COLOR_MODE_HSL = 2,
};

enum AngleMode {
  ANGLE_MODE_RADIANS = 0,
  ANGLE_MODE_DEGREES = 1,
};

enum ArcMode {
  ARC_MODE_OPEN = 100,
  ARC_MODE_CHORD = 101,
  ARC_MODE_PIE = 102,
};

enum StrokeCapMode {
  STROKE_CAP_ROUND = 200,
  STROKE_CAP_SQUARE = 201,
  STROKE_CAP_PROJECT = 202,
};

enum StrokeJoinMode {
  STROKE_JOIN_MITER = 300,
  STROKE_JOIN_BEVEL = 301,
  STROKE_JOIN_ROUND = 302,
};

enum BlendMode {
  BLEND_MODE_BLEND = 400,
  BLEND_MODE_ADD = 401,
  BLEND_MODE_DARKEST = 402,
  BLEND_MODE_LIGHTEST = 403,
  BLEND_MODE_DIFFERENCE = 404,
  BLEND_MODE_EXCLUSION = 405,
  BLEND_MODE_MULTIPLY = 406,
  BLEND_MODE_SCREEN = 407,
  BLEND_MODE_REPLACE = 408,
  BLEND_MODE_REMOVE = 409,
  BLEND_MODE_OVERLAY = 410,
  BLEND_MODE_HARD_LIGHT = 411,
  BLEND_MODE_SOFT_LIGHT = 412,
  BLEND_MODE_DODGE = 413,
  BLEND_MODE_BURN = 414,
};

struct RuntimeImagePixelBuffer {
  std::vector<PF_Pixel> values;
};

struct RuntimeImageAsset {
  int id = 0;
  std::string source;
  std::string path;
  int width = 0;
  int height = 0;
  double pixelDensity = 1.0;
  std::uint64_t version = 1;
  bool loaded = false;
  std::string loadError;
  // Pixel storage is copy-on-write. Scene snapshots and frame plans may retain
  // the same immutable contents without copying the decoded image for every
  // frame. Mutating image APIs must acquire a writable buffer through
  // AcquireWritableImagePixels() before changing any pixel.
  std::shared_ptr<RuntimeImagePixelBuffer> pixelBuffer;
  bool sceneBacked = false;
  std::shared_ptr<ScenePayload> sceneSource;
};

inline const std::vector<PF_Pixel>& ReadImagePixels(const RuntimeImageAsset& asset) {
  static const std::vector<PF_Pixel> emptyPixels;
  return asset.pixelBuffer ? asset.pixelBuffer->values : emptyPixels;
}

inline bool HasImagePixels(const RuntimeImageAsset& asset) {
  return asset.pixelBuffer && !asset.pixelBuffer->values.empty();
}

inline std::vector<PF_Pixel>& AcquireWritableImagePixels(RuntimeImageAsset& asset) {
  if (!asset.pixelBuffer) {
    asset.pixelBuffer = std::make_shared<RuntimeImagePixelBuffer>();
  } else if (asset.pixelBuffer.use_count() != 1) {
    asset.pixelBuffer = std::make_shared<RuntimeImagePixelBuffer>(*asset.pixelBuffer);
  }
  return asset.pixelBuffer->values;
}

inline void ReplaceImagePixels(RuntimeImageAsset* asset, std::vector<PF_Pixel> pixels) {
  if (!asset) {
    return;
  }
  auto buffer = std::make_shared<RuntimeImagePixelBuffer>();
  buffer->values = std::move(pixels);
  asset->pixelBuffer = std::move(buffer);
}

inline void ClearImagePixels(RuntimeImageAsset* asset) {
  if (asset) {
    asset->pixelBuffer.reset();
  }
}

struct SceneCommand {
  std::string type;
  std::string filterKind;
  std::string text;
  std::string fontName;
  std::string fontPath;
  std::string fontSourceKind = "system";
  std::string textStyle = "NORMAL";
  std::string textWrap = "WORD";
  ScalarSpec x = {"pixels", 0.0};
  ScalarSpec y = {"pixels", 0.0};
  ScalarSpec width = {"pixels", 0.0};
  ScalarSpec height = {"pixels", 0.0};
  ScalarSpec x1 = {"pixels", 0.0};
  ScalarSpec y1 = {"pixels", 0.0};
  ScalarSpec x2 = {"pixels", 0.0};
  ScalarSpec y2 = {"pixels", 0.0};
  PF_Pixel fill = {0, 0, 0, 0};
  bool hasFill = false;
  PF_Pixel stroke = {0, 0, 0, 0};
  bool hasStroke = false;
  double strokeWeight = 1.0;
  int strokeCap = STROKE_CAP_ROUND;
  int strokeJoin = STROKE_JOIN_MITER;
  int blendMode = BLEND_MODE_BLEND;
  bool eraseFill = false;
  bool eraseStroke = false;
  double eraseFillStrength = 1.0;
  double eraseStrokeStrength = 1.0;
  bool clipPath = false;
  bool clipInvert = false;
  bool textHasWidth = false;
  bool textHasHeight = false;
  double textSize = 12.0;
  double textLeading = 15.0;
  int textAlignH = 0;
  int textAlignV = 3;
  int imageId = 0;
  int maskImageId = 0;
  bool imageHasSourceRect = false;
  double imageSourceX = 0.0;
  double imageSourceY = 0.0;
  double imageSourceWidth = 0.0;
  double imageSourceHeight = 0.0;
  bool imageHasTint = false;
  PF_Pixel imageTint = {255, 255, 255, 255};
  bool filterHasValue = false;
  double filterValue = 0.0;
  Transform2D transform;
  VectorPath path;
  std::vector<VertexSpec> vertices;
  std::vector<std::vector<VertexSpec>> contours;
  bool closePath = false;
};

struct ScenePayload {
  double canvasWidth = 0.0;
  double canvasHeight = 0.0;
  std::unordered_map<int, RuntimeImageAsset> imageAssets;
  std::vector<SceneCommand> commands;
};

struct RuntimeStyleState {
  PF_Pixel currentFill = {255, 255, 255, 255};
  bool hasFill = true;
  bool fillExplicit = false;
  PF_Pixel currentStroke = {255, 0, 0, 0};
  bool hasStroke = true;
  bool strokeExplicit = false;
  double strokeWeight = 1.0;
  Transform2D currentTransform;
  int rectMode = SHAPE_MODE_CORNER;
  int ellipseMode = SHAPE_MODE_CENTER;
  int colorMode = COLOR_MODE_RGB;
  int strokeCap = STROKE_CAP_ROUND;
  int strokeJoin = STROKE_JOIN_MITER;
  double curveTightness = 0.0;
  int blendMode = BLEND_MODE_BLEND;
  int imageMode = SHAPE_MODE_CORNER;
  double pixelDensity = 1.0;
  bool imageTintEnabled = false;
  PF_Pixel currentImageTint = {255, 255, 255, 255};
  bool eraseActive = false;
  double eraseFillStrength = 1.0;
  double eraseStrokeStrength = 1.0;
  bool clipCapturing = false;
  bool clipInvert = false;
  std::string textFontName = "Arial";
  std::string textFontPath;
  std::string textFontSourceKind = "system";
  std::string textStyle = "NORMAL";
  std::string textWrap = "WORD";
  double textSize = 12.0;
  double textLeading = 15.0;
  bool textLeadingExplicit = false;
  int textAlignH = 0;
  int textAlignV = 3;
};

struct RuntimeSnapshot : RuntimeStyleState {};

struct GraphicsSurfaceState : RuntimeStyleState {
  int angleMode = ANGLE_MODE_RADIANS;
  int nextImageId = 1;
  int canvasImageId = 0;
  std::uint64_t sceneVersion = 0;
  std::uint64_t canvasImageSceneVersion = 0;
  int outputImageId = 0;
  bool bitmapMode = false;
  bool bitmapTouchedThisSession = false;
  std::unordered_map<int, RuntimeImageAsset> imageAssets;
  ScenePayload scene;
  std::vector<RuntimeSnapshot> stateStack;
  std::vector<VertexSpec> shapeVertices;
  std::vector<std::vector<VertexSpec>> shapeContours;
  std::vector<VertexSpec> curveVertices;
  std::vector<VertexSpec> contourVertices;
  std::vector<VertexSpec> contourCurveVertices;
  PathSubpath shapeSubpath;
  std::vector<PathSubpath> shapeContourSubpaths;
  PathSubpath contourSubpath;
  bool shapeUsesCurve = false;
  bool contourUsesCurve = false;
  bool insideContour = false;
  int shapeKind = BEGIN_SHAPE_DEFAULT;
  double desiredFrameRate = 0.0;
};

}  // namespace momentum
