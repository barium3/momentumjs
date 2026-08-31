#pragma once

#include "scene/types.h"

namespace momentum {
namespace bitmap {

enum BitmapSurfaceStart : std::uint8_t {
  BITMAP_SURFACE_INHERIT = 0,
  BITMAP_SURFACE_CLEAR = 1,
};

struct BitmapDrawPlan {
  ScenePayload scene;
  A_long width = 0;
  A_long height = 0;
  std::uint64_t cacheKey = 0;
  long targetFrame = 0;

  // CLEAR is a proven history barrier: no earlier canvas pixels are read.
  BitmapSurfaceStart surfaceStart = BITMAP_SURFACE_INHERIT;
  PF_Pixel surfaceColor = {0, 0, 0, 0};

  struct FillTriangle {
    float x1 = 0.0f;
    float y1 = 0.0f;
    float x2 = 0.0f;
    float y2 = 0.0f;
    float x3 = 0.0f;
    float y3 = 0.0f;
    PF_Pixel color = {255, 255, 255, 255};
  };

  struct BoundaryEdge {
    float x1 = 0.0f;
    float y1 = 0.0f;
    float x2 = 0.0f;
    float y2 = 0.0f;
  };

  struct PathFillVertex {
    float x = 0.0f;
    float y = 0.0f;
  };

  struct PathFillContour {
    std::uint32_t vertexStart = 0;
    std::uint32_t vertexCount = 0;
  };

  struct PathFill {
    std::uint32_t contourStart = 0;
    std::uint32_t contourCount = 0;
    float minX = 0.0f;
    float minY = 0.0f;
    float maxX = 0.0f;
    float maxY = 0.0f;
    PF_Pixel color = {255, 255, 255, 255};
  };

  struct ImageDraw {
    float x1 = 0.0f;
    float y1 = 0.0f;
    float u1 = 0.0f;
    float v1 = 0.0f;
    float x2 = 0.0f;
    float y2 = 0.0f;
    float u2 = 1.0f;
    float v2 = 0.0f;
    float x3 = 0.0f;
    float y3 = 0.0f;
    float u3 = 1.0f;
    float v3 = 1.0f;
    float x4 = 0.0f;
    float y4 = 0.0f;
    float u4 = 0.0f;
    float v4 = 1.0f;
    int imageId = 0;
    std::uint64_t imageVersion = 0;
    PF_Pixel tint = {255, 255, 255, 255};
  };

  struct FilterPass {
    std::int32_t filterKind = 0;
    float value = 0.0f;
  };

  struct MaskPass {
    int maskImageId = 0;
    std::uint64_t maskImageVersion = 0;
  };

  enum DrawBatchType : std::uint8_t {
    DRAW_BATCH_FILLS = 0,
    DRAW_BATCH_STROKES = 1,
    DRAW_BATCH_IMAGES = 2,
    DRAW_BATCH_PATH_FILLS = 3,
    DRAW_BATCH_FILTERS = 4,
    DRAW_BATCH_MASKS = 5,
    DRAW_BATCH_TEXT_IMAGES = 6,
  };

  struct DrawBatch {
    DrawBatchType type = DRAW_BATCH_FILLS;
    std::size_t start = 0;
    std::size_t count = 0;
    std::size_t explicitEdgeStart = 0;
    std::size_t explicitEdgeCount = 0;
    int blendMode = BLEND_MODE_BLEND;
    bool erase = false;
    float eraseStrength = 1.0f;
    int clipImageId = 0;
    bool hasAnalyticClip = false;
    std::uint32_t clipContourStart = 0;
    std::uint32_t clipContourCount = 0;
    float clipMinX = 0.0f;
    float clipMinY = 0.0f;
    float clipMaxX = 0.0f;
    float clipMaxY = 0.0f;
  };

  std::vector<FillTriangle> fillTriangles;
  std::vector<BoundaryEdge> boundaryEdges;
  std::vector<FillTriangle> strokeTriangles;
  std::vector<BoundaryEdge> strokeBoundaryEdges;
  std::vector<PathFillVertex> pathFillVertices;
  std::vector<PathFillContour> pathFillContours;
  std::vector<PathFill> pathFills;
  std::vector<ImageDraw> imageDraws;
  std::vector<FilterPass> filterPasses;
  std::vector<MaskPass> maskPasses;
  std::vector<DrawBatch> drawBatches;
};

struct BitmapFramePlanOp {
  long frame = 0;
  BitmapDrawPlan drawPlan;
};

struct BitmapFramePlan {
  std::uint64_t cacheKey = 0;
  long targetFrame = 0;
  A_long width = 0;
  A_long height = 0;
  A_long logicalWidth = 0;
  A_long logicalHeight = 0;
  long checkpointInterval = 0;

  // Every frame plan is correctness-complete. A renderer may skip leading
  // operations only after selecting a validated immutable or working seed.
  BitmapSurfaceStart fallbackSurfaceStart = BITMAP_SURFACE_CLEAR;
  PF_Pixel fallbackSurfaceColor = {0, 0, 0, 0};
  bool supported = true;
  std::string unsupportedReason;
  std::vector<BitmapFramePlanOp> operations;
};

}  // namespace bitmap
}  // namespace momentum
