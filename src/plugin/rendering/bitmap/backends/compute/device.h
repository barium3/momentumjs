#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace momentum {
namespace bitmap {
namespace compute {

// These types form the host/kernel ABI shared by CUDA and OpenCL. Keep them
// scalar-only and standard-layout so neither backend inherits vendor-specific
// vector alignment rules.
struct Float2 {
  float x = 0.0f;
  float y = 0.0f;
};

struct Float4 {
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;
  float w = 0.0f;
};

struct FillTriangleData {
  Float2 a;
  Float2 b;
  Float2 c;
};

struct EdgeSegment {
  Float2 a;
  Float2 b;
};

struct PathFillContour {
  std::uint32_t vertexStart = 0;
  std::uint32_t vertexCount = 0;
};

struct Buffer {
  void* memory = nullptr;
  std::size_t byteSize = 0;
};

struct FillParams {
  std::uint32_t regionOriginX = 0;
  std::uint32_t regionOriginY = 0;
  std::uint32_t regionWidth = 0;
  std::uint32_t regionHeight = 0;
  std::uint32_t canvasWidth = 0;
  std::uint32_t canvasHeight = 0;
  std::uint32_t triangleCount = 0;
  std::uint32_t edgeCount = 0;
  std::uint32_t clipContourStart = 0;
  std::uint32_t clipContourCount = 0;
  std::uint32_t clipWidth = 1;
  std::uint32_t clipHeight = 1;
  float colorR = 0.0f;
  float colorG = 0.0f;
  float colorB = 0.0f;
  float colorA = 0.0f;
  float boundsMinX = 0.0f;
  float boundsMinY = 0.0f;
  float boundsMaxX = 0.0f;
  float boundsMaxY = 0.0f;
  float clipMinX = 0.0f;
  float clipMinY = 0.0f;
  float clipMaxX = 0.0f;
  float clipMaxY = 0.0f;
};

struct PathFillParams {
  std::uint32_t regionOriginX = 0;
  std::uint32_t regionOriginY = 0;
  std::uint32_t regionWidth = 0;
  std::uint32_t regionHeight = 0;
  std::uint32_t canvasWidth = 0;
  std::uint32_t canvasHeight = 0;
  std::uint32_t contourStart = 0;
  std::uint32_t contourCount = 0;
  std::uint32_t clipContourStart = 0;
  std::uint32_t clipContourCount = 0;
  std::uint32_t clipWidth = 1;
  std::uint32_t clipHeight = 1;
  float colorR = 0.0f;
  float colorG = 0.0f;
  float colorB = 0.0f;
  float colorA = 0.0f;
  float boundsMinX = 0.0f;
  float boundsMinY = 0.0f;
  float boundsMaxX = 0.0f;
  float boundsMaxY = 0.0f;
  float clipMinX = 0.0f;
  float clipMinY = 0.0f;
  float clipMaxX = 0.0f;
  float clipMaxY = 0.0f;
};

struct ImageParams {
  std::uint32_t regionOriginX = 0;
  std::uint32_t regionOriginY = 0;
  std::uint32_t regionWidth = 0;
  std::uint32_t regionHeight = 0;
  std::uint32_t canvasWidth = 0;
  std::uint32_t canvasHeight = 0;
  std::uint32_t imageWidth = 0;
  std::uint32_t imageHeight = 0;
  std::uint32_t clipWidth = 1;
  std::uint32_t clipHeight = 1;
  std::uint32_t textImage = 0;
  std::uint32_t reserved = 0;
  float x1 = 0.0f;
  float y1 = 0.0f;
  float u1 = 0.0f;
  float v1 = 0.0f;
  float x2 = 0.0f;
  float y2 = 0.0f;
  float u2 = 0.0f;
  float v2 = 0.0f;
  float x3 = 0.0f;
  float y3 = 0.0f;
  float u3 = 0.0f;
  float v3 = 0.0f;
  float x4 = 0.0f;
  float y4 = 0.0f;
  float u4 = 0.0f;
  float v4 = 0.0f;
  float tintR = 1.0f;
  float tintG = 1.0f;
  float tintB = 1.0f;
  float tintA = 1.0f;
};

struct BlendParams {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::int32_t blendMode = 0;
  std::uint32_t erase = 0;
  float eraseStrength = 1.0f;
};

struct FilterParams {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::int32_t filterKind = 0;
  float value = 0.0f;
};

struct CopyOutputParams {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint32_t rowPixels = 0;
  std::uint32_t sourceWidth = 0;
  std::uint32_t sourceHeight = 0;
  std::uint32_t logicalWidth = 0;
  std::uint32_t logicalHeight = 0;
  float sourceOriginX = 0.0f;
  float sourceOriginY = 0.0f;
  float sourceStepX = 1.0f;
  float sourceStepY = 1.0f;
};

static_assert(sizeof(Float2) == 8, "compute Float2 ABI changed");
static_assert(sizeof(Float4) == 16, "compute Float4 ABI changed");
static_assert(sizeof(FillTriangleData) == 24, "compute triangle ABI changed");
static_assert(sizeof(EdgeSegment) == 16, "compute edge ABI changed");
static_assert(sizeof(PathFillContour) == 8, "compute contour ABI changed");
static_assert(sizeof(FillParams) == 96, "compute fill parameter ABI changed");
static_assert(sizeof(PathFillParams) == 96, "compute path parameter ABI changed");
static_assert(sizeof(ImageParams) == 128, "compute image parameter ABI changed");
static_assert(sizeof(BlendParams) == 20, "compute blend parameter ABI changed");
static_assert(sizeof(FilterParams) == 16, "compute filter parameter ABI changed");
static_assert(sizeof(CopyOutputParams) == 44, "compute output parameter ABI changed");

class Device {
 public:
  virtual ~Device() = default;

  virtual bool Upload(
    const Buffer& destination,
    const void* source,
    std::size_t byteSize,
    std::string* errorMessage
  ) = 0;

  virtual bool Clear(
    const Buffer& destination,
    std::uint32_t width,
    std::uint32_t height,
    const Float4& premultipliedColor,
    std::string* errorMessage
  ) = 0;

  virtual bool Copy(
    const Buffer& source,
    const Buffer& destination,
    std::uint32_t width,
    std::uint32_t height,
    std::string* errorMessage
  ) = 0;

  virtual bool Fill(
    const Buffer& destination,
    const Buffer& triangles,
    const Buffer& edges,
    const Buffer& clipVertices,
    const Buffer& clipContours,
    const Buffer& clipImage,
    const FillParams& params,
    std::string* errorMessage
  ) = 0;

  virtual bool PathFill(
    const Buffer& destination,
    const Buffer& vertices,
    const Buffer& contours,
    const Buffer& clipImage,
    const PathFillParams& params,
    std::string* errorMessage
  ) = 0;

  virtual bool Image(
    const Buffer& destination,
    const Buffer& image,
    const Buffer& clipImage,
    const ImageParams& params,
    std::string* errorMessage
  ) = 0;

  virtual bool Composite(
    const Buffer& source,
    const Buffer& destination,
    const BlendParams& params,
    std::string* errorMessage
  ) = 0;

  virtual bool Filter(
    const Buffer& source,
    const Buffer& destination,
    const FilterParams& params,
    std::string* errorMessage
  ) = 0;

  virtual bool Mask(
    const Buffer& source,
    const Buffer& mask,
    const Buffer& destination,
    std::uint32_t width,
    std::uint32_t height,
    std::uint32_t maskWidth,
    std::uint32_t maskHeight,
    std::string* errorMessage
  ) = 0;

  virtual bool CopyToOutput(
    const Buffer& source,
    void* outputMemory,
    const CopyOutputParams& params,
    std::string* errorMessage
  ) = 0;

  virtual bool Finish(std::string* errorMessage) = 0;
};

}  // namespace compute
}  // namespace bitmap
}  // namespace momentum
