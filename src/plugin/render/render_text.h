#pragma once

#include <string>
#include <vector>

#include "../model/momentum_types.h"

namespace momentum {

struct TextLayoutMetrics {
  double width = 0.0;
  double height = 0.0;
  double ascent = 0.0;
  double descent = 0.0;
};

struct FontDescriptor {
  std::string source;
  std::string fontName;
  std::string fontPath;
  std::string fontSourceKind = "system";
  bool loaded = false;
  std::string loadError;
};

struct TextBounds {
  double x = 0.0;
  double y = 0.0;
  double width = 0.0;
  double height = 0.0;
  TextLayoutMetrics metrics;
};

struct TextPoint {
  double x = 0.0;
  double y = 0.0;
  double alpha = 0.0;
};

struct RasterizedText {
  int width = 0;
  int height = 0;
  double originX = 0.0;
  double originY = 0.0;
  TextLayoutMetrics metrics;
  std::vector<unsigned char> fillAlpha;
  std::vector<unsigned char> strokeAlpha;
};

struct GlyphAtlasQuad {
  double x1 = 0.0;
  double y1 = 0.0;
  double u1 = 0.0;
  double v1 = 0.0;
  double x2 = 0.0;
  double y2 = 0.0;
  double u2 = 1.0;
  double v2 = 0.0;
  double x3 = 0.0;
  double y3 = 0.0;
  double u3 = 1.0;
  double v3 = 1.0;
  double x4 = 0.0;
  double y4 = 0.0;
  double u4 = 0.0;
  double v4 = 1.0;
};

struct GlyphAtlasTextRender {
  TextLayoutMetrics metrics;
  bool hasFillAtlas = false;
  RuntimeImageAsset fillAtlas;
  std::vector<GlyphAtlasQuad> fillQuads;
  bool hasStrokeAtlas = false;
  RuntimeImageAsset strokeAtlas;
  std::vector<GlyphAtlasQuad> strokeQuads;
};

bool ResolveFont(
  const std::string& fontName,
  const std::string& fontPath,
  const std::string& fontSourceKind,
  const std::string& textStyle,
  FontDescriptor* outDescriptor
);
bool MeasureTextCommand(const SceneCommand& command, TextLayoutMetrics* outMetrics);
bool ComputeTextBounds(const SceneCommand& command, TextBounds* outBounds);
bool ComputeTextPoints(
  const SceneCommand& command,
  double sampleFactor,
  double simplifyThreshold,
  std::vector<TextPoint>* outPoints
);
bool RasterizeTextCommand(const SceneCommand& command, RasterizedText* outRasterized);
bool BuildGlyphAtlasTextCommand(
  const SceneCommand& command,
  int fillImageId,
  int strokeImageId,
  GlyphAtlasTextRender* outRender
);

}  // namespace momentum
