#include "render_core.h"
#include "render_internal.h"
#include "render_image.h"
#include "render_text.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

namespace momentum {

namespace {

constexpr double kAnalyticAaFeather = 1.0;
constexpr double kFillAaFeather = 0.875;
constexpr double kStrokeAaFeather = 0.625;
constexpr int kCoverageSampleCount = 8;
constexpr double kCoverageSampleOffsets[kCoverageSampleCount][2] = {
  {0.0625, 0.1875},
  {0.5625, 0.0625},
  {0.3125, 0.4375},
  {0.8125, 0.3125},
  {0.1875, 0.6875},
  {0.6875, 0.5625},
  {0.4375, 0.9375},
  {0.9375, 0.8125},
};

struct RenderCommandState {
  const std::vector<double>* clipMask = NULL;
  int blendMode = BLEND_MODE_BLEND;
};

thread_local RenderCommandState g_renderCommandState;

double ClampUnit(double value) {
  return std::max(0.0, std::min(1.0, value));
}

double ClampByteLike(double value, double channelMax) {
  return std::max(0.0, std::min(channelMax, value));
}

ScalarSpec ScaleScalarSpecForRender(const ScalarSpec& spec, double scale) {
  ScalarSpec scaled = spec;
  if (scaled.mode == "pixels") {
    scaled.value *= scale;
  }
  return scaled;
}

VertexSpec ScaleVertexSpecForRender(const VertexSpec& vertex, double scale) {
  VertexSpec scaled = vertex;
  scaled.x = ScaleScalarSpecForRender(vertex.x, scale);
  scaled.y = ScaleScalarSpecForRender(vertex.y, scale);
  return scaled;
}

PathSegment ScalePathSegmentForRender(const PathSegment& segment, double scale) {
  PathSegment scaled = segment;
  scaled.point = ScaleVertexSpecForRender(segment.point, scale);
  scaled.control1 = ScaleVertexSpecForRender(segment.control1, scale);
  scaled.control2 = ScaleVertexSpecForRender(segment.control2, scale);
  return scaled;
}

PathSubpath ScalePathSubpathForRender(const PathSubpath& subpath, double scale) {
  PathSubpath scaled = subpath;
  scaled.segments.clear();
  scaled.segments.reserve(subpath.segments.size());
  for (const PathSegment& segment : subpath.segments) {
    scaled.segments.push_back(ScalePathSegmentForRender(segment, scale));
  }
  return scaled;
}

VectorPath ScaleVectorPathForRender(const VectorPath& path, double scale) {
  VectorPath scaled = path;
  scaled.subpaths.clear();
  scaled.subpaths.reserve(path.subpaths.size());
  for (const PathSubpath& subpath : path.subpaths) {
    scaled.subpaths.push_back(ScalePathSubpathForRender(subpath, scale));
  }
  return scaled;
}

std::vector<VertexSpec> ScaleVertexListForRender(
  const std::vector<VertexSpec>& vertices,
  double scale
) {
  std::vector<VertexSpec> scaled;
  scaled.reserve(vertices.size());
  for (const VertexSpec& vertex : vertices) {
    scaled.push_back(ScaleVertexSpecForRender(vertex, scale));
  }
  return scaled;
}

SceneCommand ScaleSceneCommandForRender(const SceneCommand& command, double scale) {
  SceneCommand scaled = command;
  scaled.x = ScaleScalarSpecForRender(command.x, scale);
  scaled.y = ScaleScalarSpecForRender(command.y, scale);
  scaled.width = ScaleScalarSpecForRender(command.width, scale);
  scaled.height = ScaleScalarSpecForRender(command.height, scale);
  scaled.x1 = ScaleScalarSpecForRender(command.x1, scale);
  scaled.y1 = ScaleScalarSpecForRender(command.y1, scale);
  scaled.x2 = ScaleScalarSpecForRender(command.x2, scale);
  scaled.y2 = ScaleScalarSpecForRender(command.y2, scale);
  scaled.strokeWeight = command.strokeWeight * scale;
  scaled.textSize = command.textSize * scale;
  scaled.textLeading = command.textLeading * scale;
  if (scaled.filterHasValue) {
    scaled.filterValue *= scale;
  }
  scaled.transform.tx = command.transform.tx * scale;
  scaled.transform.ty = command.transform.ty * scale;
  scaled.path = ScaleVectorPathForRender(command.path, scale);
  scaled.vertices = ScaleVertexListForRender(command.vertices, scale);
  scaled.contours.clear();
  scaled.contours.reserve(command.contours.size());
  for (const std::vector<VertexSpec>& contour : command.contours) {
    scaled.contours.push_back(ScaleVertexListForRender(contour, scale));
  }
  return scaled;
}

double SampleClipMask(const std::vector<double>* clipMask, PF_LayerDef* output, A_long x, A_long y) {
  if (!clipMask || !output || clipMask->empty()) {
    return 1.0;
  }
  if (x < 0 || y < 0 || x >= output->width || y >= output->height) {
    return 0.0;
  }
  return ClampUnit((*clipMask)[static_cast<std::size_t>(y * output->width + x)]);
}

double CoverageFromSignedDistance(double signedDistance, double feather = kAnalyticAaFeather) {
  const double safeFeather = feather > 1e-6 ? feather : kAnalyticAaFeather;
  return ClampUnit(0.5 - (signedDistance / safeFeather));
}

template <typename Fn>
double SampleCoverageAtPixel(A_long px, A_long py, Fn&& sampleFn) {
  double coverage = 0.0;
  for (int sample = 0; sample < kCoverageSampleCount; ++sample) {
    coverage += ClampUnit(sampleFn(
      static_cast<double>(px) + kCoverageSampleOffsets[sample][0],
      static_cast<double>(py) + kCoverageSampleOffsets[sample][1]
    ));
  }
  return coverage / static_cast<double>(kCoverageSampleCount);
}

template <typename Fn>
double SampleCoverageAroundPoint(double centerX, double centerY, Fn&& sampleFn) {
  double coverage = 0.0;
  for (int sample = 0; sample < kCoverageSampleCount; ++sample) {
    coverage += ClampUnit(sampleFn(
      centerX + (kCoverageSampleOffsets[sample][0] - 0.5),
      centerY + (kCoverageSampleOffsets[sample][1] - 0.5)
    ));
  }
  return coverage / static_cast<double>(kCoverageSampleCount);
}

template <typename PixelType>
void FillBackground(PF_LayerDef* output, const PixelType& color) {
  for (A_long y = 0; y < output->height; ++y) {
    auto* row = reinterpret_cast<PixelType*>(
      reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
    );
    for (A_long x = 0; x < output->width; ++x) {
      row[x] = color;
    }
  }
}

template <typename PixelType>
PixelType BlendPixelColor(
  const PixelType& destination,
  const PixelType& source,
  double coverage,
  int blendMode,
  bool erase,
  double eraseStrength
);

template <typename PixelType>
void BlendBackground(PF_LayerDef* output, const PixelType& color) {
  for (A_long y = 0; y < output->height; ++y) {
    auto* row = reinterpret_cast<PixelType*>(
      reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
    );
    for (A_long x = 0; x < output->width; ++x) {
      row[x] = BlendPixelColor(row[x], color, 1.0, BLEND_MODE_BLEND, false, 1.0);
    }
  }
}

template <typename PixelType>
void PutPixel(
  PF_LayerDef* output,
  A_long x,
  A_long y,
  const PixelType& color,
  bool erase = false,
  double eraseStrength = 1.0
) {
  if (x < 0 || y < 0 || x >= output->width || y >= output->height) {
    return;
  }

  const double clipCoverage = SampleClipMask(g_renderCommandState.clipMask, output, x, y);
  if (clipCoverage <= 0.0) {
    return;
  }

  auto* row = reinterpret_cast<PixelType*>(
    reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
  );
  row[x] = BlendPixelColor(
    row[x],
    color,
    clipCoverage,
    g_renderCommandState.blendMode,
    erase,
    eraseStrength
  );
}

template <typename PixelType>
double GetChannelMax();

template <>
double GetChannelMax<PF_Pixel>() {
  return 255.0;
}

template <>
double GetChannelMax<PF_Pixel16>() {
  return 65535.0;
}

double BlendChannel(double destination, double source, int blendMode) {
  switch (blendMode) {
    case BLEND_MODE_ADD:
      return ClampUnit(destination + source);
    case BLEND_MODE_DARKEST:
      return std::min(destination, source);
    case BLEND_MODE_LIGHTEST:
      return std::max(destination, source);
    case BLEND_MODE_DIFFERENCE:
      return std::fabs(destination - source);
    case BLEND_MODE_EXCLUSION:
      return destination + source - 2.0 * destination * source;
    case BLEND_MODE_MULTIPLY:
      return destination * source;
    case BLEND_MODE_SCREEN:
      return 1.0 - (1.0 - destination) * (1.0 - source);
    case BLEND_MODE_OVERLAY:
      return destination <= 0.5
        ? 2.0 * destination * source
        : 1.0 - 2.0 * (1.0 - destination) * (1.0 - source);
    case BLEND_MODE_HARD_LIGHT:
      return source <= 0.5
        ? 2.0 * destination * source
        : 1.0 - 2.0 * (1.0 - destination) * (1.0 - source);
    case BLEND_MODE_SOFT_LIGHT: {
      const double helper = destination <= 0.25
        ? ((16.0 * destination - 12.0) * destination + 4.0) * destination
        : std::sqrt(destination);
      return source <= 0.5
        ? destination - (1.0 - 2.0 * source) * destination * (1.0 - destination)
        : destination + (2.0 * source - 1.0) * (helper - destination);
    }
    case BLEND_MODE_DODGE:
      return source >= 1.0 ? 1.0 : ClampUnit(destination / std::max(1e-6, 1.0 - source));
    case BLEND_MODE_BURN:
      return source <= 0.0 ? 0.0 : 1.0 - ClampUnit((1.0 - destination) / std::max(1e-6, source));
    case BLEND_MODE_BLEND:
    case BLEND_MODE_REPLACE:
    case BLEND_MODE_REMOVE:
    default:
      return source;
  }
}

template <typename PixelType>
PixelType BlendPixelColor(
  const PixelType& destination,
  const PixelType& source,
  double coverage,
  int blendMode,
  bool erase,
  double eraseStrength
) {
  const double channelMax = GetChannelMax<PixelType>();
  const double sourceAlpha =
    ClampUnit((static_cast<double>(source.alpha) / channelMax) * coverage);
  const double destinationAlpha =
    ClampUnit(static_cast<double>(destination.alpha) / channelMax);

  PixelType result = destination;
  if (sourceAlpha <= 0.0 && !erase) {
    return result;
  }

  if (erase || blendMode == BLEND_MODE_REMOVE) {
    const double removal = ClampUnit(sourceAlpha * ClampUnit(erase ? eraseStrength : 1.0));
    const double outAlpha = destinationAlpha * (1.0 - removal);
    if (outAlpha <= 0.0) {
      result.alpha = 0;
      result.red = 0;
      result.green = 0;
      result.blue = 0;
      return result;
    }

    result.alpha = static_cast<decltype(result.alpha)>(std::round(ClampByteLike(outAlpha * channelMax, channelMax)));
    return result;
  }

  const double sourceRed = static_cast<double>(source.red) / channelMax;
  const double sourceGreen = static_cast<double>(source.green) / channelMax;
  const double sourceBlue = static_cast<double>(source.blue) / channelMax;
  const double destRed = static_cast<double>(destination.red) / channelMax;
  const double destGreen = static_cast<double>(destination.green) / channelMax;
  const double destBlue = static_cast<double>(destination.blue) / channelMax;

  if (blendMode == BLEND_MODE_REPLACE) {
    result.alpha = static_cast<decltype(result.alpha)>(std::round(ClampByteLike(sourceAlpha * channelMax, channelMax)));
    result.red = static_cast<decltype(result.red)>(std::round(ClampByteLike(sourceRed * channelMax, channelMax)));
    result.green = static_cast<decltype(result.green)>(std::round(ClampByteLike(sourceGreen * channelMax, channelMax)));
    result.blue = static_cast<decltype(result.blue)>(std::round(ClampByteLike(sourceBlue * channelMax, channelMax)));
    return result;
  }

  const double outAlpha = sourceAlpha + destinationAlpha * (1.0 - sourceAlpha);
  if (outAlpha <= 0.0) {
    result.alpha = 0;
    result.red = 0;
    result.green = 0;
    result.blue = 0;
    return result;
  }

  const double blendedRed = BlendChannel(destRed, sourceRed, blendMode);
  const double blendedGreen = BlendChannel(destGreen, sourceGreen, blendMode);
  const double blendedBlue = BlendChannel(destBlue, sourceBlue, blendMode);

  const double outRed =
    ((1.0 - sourceAlpha) * destinationAlpha * destRed +
     (1.0 - destinationAlpha) * sourceAlpha * sourceRed +
     destinationAlpha * sourceAlpha * blendedRed) /
    outAlpha;
  const double outGreen =
    ((1.0 - sourceAlpha) * destinationAlpha * destGreen +
     (1.0 - destinationAlpha) * sourceAlpha * sourceGreen +
     destinationAlpha * sourceAlpha * blendedGreen) /
    outAlpha;
  const double outBlue =
    ((1.0 - sourceAlpha) * destinationAlpha * destBlue +
     (1.0 - destinationAlpha) * sourceAlpha * sourceBlue +
     destinationAlpha * sourceAlpha * blendedBlue) /
    outAlpha;

  result.alpha = static_cast<decltype(result.alpha)>(std::round(ClampByteLike(outAlpha * channelMax, channelMax)));
  result.red = static_cast<decltype(result.red)>(std::round(ClampByteLike(outRed * channelMax, channelMax)));
  result.green = static_cast<decltype(result.green)>(std::round(ClampByteLike(outGreen * channelMax, channelMax)));
  result.blue = static_cast<decltype(result.blue)>(std::round(ClampByteLike(outBlue * channelMax, channelMax)));
  return result;
}

template <typename PixelType>
void BlendPixel(
  PF_LayerDef* output,
  A_long x,
  A_long y,
  const PixelType& color,
  double coverage,
  bool erase = false,
  double eraseStrength = 1.0
) {
  if (coverage <= 0.0 || x < 0 || y < 0 || x >= output->width || y >= output->height) {
    return;
  }

  const double clipCoverage = SampleClipMask(g_renderCommandState.clipMask, output, x, y);
  coverage *= clipCoverage;
  if (coverage <= 0.0) {
    return;
  }

  auto* row = reinterpret_cast<PixelType*>(
    reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
  );
  row[x] = BlendPixelColor(
    row[x],
    color,
    coverage,
    g_renderCommandState.blendMode,
    erase,
    eraseStrength
  );
}

template <typename PixelType>
void DrawEllipseTransformedAt(
  PF_LayerDef* output,
  const PixelType* fillColor,
  const PixelType* strokeColor,
  double cx,
  double cy,
  double rx,
  double ry,
  double strokeWeight,
  const Transform2D& transform,
  bool fillErase,
  double fillEraseStrength,
  bool strokeErase,
  double strokeEraseStrength
) {
  if (rx <= 0.0 || ry <= 0.0) {
    return;
  }

  Transform2D inverse;
  if (!InvertTransform(transform, &inverse)) {
    return;
  }

  const double left = cx - rx;
  const double top = cy - ry;
  const double right = cx + rx;
  const double bottom = cy + ry;
  double cornersX[4];
  double cornersY[4];
  ApplyTransform(transform, left, top, &cornersX[0], &cornersY[0]);
  ApplyTransform(transform, right, top, &cornersX[1], &cornersY[1]);
  ApplyTransform(transform, right, bottom, &cornersX[2], &cornersY[2]);
  ApplyTransform(transform, left, bottom, &cornersX[3], &cornersY[3]);

  double minX = cornersX[0];
  double maxX = cornersX[0];
  double minY = cornersY[0];
  double maxY = cornersY[0];
  for (int i = 1; i < 4; ++i) {
    minX = std::min(minX, cornersX[i]);
    maxX = std::max(maxX, cornersX[i]);
    minY = std::min(minY, cornersY[i]);
    maxY = std::max(maxY, cornersY[i]);
  }

  const A_long startX = static_cast<A_long>(std::floor(minX - 1.0));
  const A_long endX = static_cast<A_long>(std::ceil(maxX + 1.0));
  const A_long startY = static_cast<A_long>(std::floor(minY - 1.0));
  const A_long endY = static_cast<A_long>(std::ceil(maxY + 1.0));
  const double transformScale = ApproximateTransformScale(transform);
  const double localStrokeInset = std::max(0.0, strokeWeight / std::max(0.001, transformScale));
  const double fillAaWidth = kFillAaFeather / std::max(0.001, transformScale);
  const double strokeAaWidth = kStrokeAaFeather / std::max(0.001, transformScale);

  for (A_long y = startY; y <= endY; ++y) {
    for (A_long x = startX; x <= endX; ++x) {
      double fillCoverage = 0.0;
      double strokeCoverage = 0.0;
      for (int sample = 0; sample < kCoverageSampleCount; ++sample) {
        double localX = 0.0;
        double localY = 0.0;
        ApplyTransform(
          inverse,
          static_cast<double>(x) + kCoverageSampleOffsets[sample][0],
          static_cast<double>(y) + kCoverageSampleOffsets[sample][1],
          &localX,
          &localY
        );

        const double dx = localX - cx;
        const double dy = localY - cy;
        const double outerNorm =
          std::sqrt((dx * dx) / std::max(1e-6, rx * rx) + (dy * dy) / std::max(1e-6, ry * ry));
        const double outerSignedDistance = (outerNorm - 1.0) * std::min(rx, ry);
        const double outerFillCoverage = fillColor
          ? CoverageFromSignedDistance(outerSignedDistance, fillAaWidth)
          : 0.0;
        const double outerStrokeCoverage = strokeColor
          ? CoverageFromSignedDistance(outerSignedDistance, strokeAaWidth)
          : 0.0;

        double fillSample = outerFillCoverage;
        double strokeSample = 0.0;

        if (strokeColor && localStrokeInset > 0.0) {
          const double innerRx = std::max(0.0, rx - localStrokeInset);
          const double innerRy = std::max(0.0, ry - localStrokeInset);
          if (innerRx <= 1e-6 || innerRy <= 1e-6) {
            strokeSample = outerStrokeCoverage;
            fillSample = 0.0;
          } else {
            const double innerNorm =
              std::sqrt((dx * dx) / std::max(1e-6, innerRx * innerRx) +
                        (dy * dy) / std::max(1e-6, innerRy * innerRy));
            const double innerSignedDistance = (innerNorm - 1.0) * std::min(innerRx, innerRy);
            const double innerFillCoverage = fillColor
              ? CoverageFromSignedDistance(innerSignedDistance, fillAaWidth)
              : 0.0;
            const double innerStrokeCoverage = strokeColor
              ? CoverageFromSignedDistance(innerSignedDistance, strokeAaWidth)
              : 0.0;
            fillSample = fillColor ? innerFillCoverage : 0.0;
            strokeSample = std::max(0.0, outerStrokeCoverage - innerStrokeCoverage);
          }
        }

        fillCoverage += fillSample;
        strokeCoverage += strokeSample;
      }

      fillCoverage /= static_cast<double>(kCoverageSampleCount);
      strokeCoverage /= static_cast<double>(kCoverageSampleCount);

      if (fillCoverage > 0.0 && fillColor) {
        BlendPixel(output, x, y, *fillColor, fillCoverage, fillErase, fillEraseStrength);
      }
      if (strokeCoverage > 0.0 && strokeColor) {
        BlendPixel(output, x, y, *strokeColor, strokeCoverage, strokeErase, strokeEraseStrength);
      }
    }
  }
}

template <typename PixelType>
void DrawRectAt(
  PF_LayerDef* output,
  const PixelType* fillColor,
  const PixelType* strokeColor,
  double x,
  double y,
  double width,
  double height,
  double strokeWeight,
  bool fillErase = false,
  double fillEraseStrength = 1.0,
  bool strokeErase = false,
  double strokeEraseStrength = 1.0
) {
  const A_long left = static_cast<A_long>(std::floor(x));
  const A_long top = static_cast<A_long>(std::floor(y));
  const A_long right = static_cast<A_long>(std::ceil(x + width));
  const A_long bottom = static_cast<A_long>(std::ceil(y + height));
  const A_long inset = std::max<A_long>(1, static_cast<A_long>(std::round(strokeWeight)));

  for (A_long py = top; py < bottom; ++py) {
    for (A_long px = left; px < right; ++px) {
      const bool onStroke =
        px < left + inset || px >= right - inset || py < top + inset || py >= bottom - inset;

      if (onStroke && strokeColor) {
        PutPixel(output, px, py, *strokeColor, strokeErase, strokeEraseStrength);
      } else if (fillColor) {
        PutPixel(output, px, py, *fillColor, fillErase, fillEraseStrength);
      }
    }
  }
}

template <typename PixelType>
void DrawRectTransformedAt(
  PF_LayerDef* output,
  const PixelType* fillColor,
  const PixelType* strokeColor,
  double x,
  double y,
  double width,
  double height,
  double strokeWeight,
  const Transform2D& transform,
  bool fillErase,
  double fillEraseStrength,
  bool strokeErase,
  double strokeEraseStrength
) {
  Transform2D inverse;
  if (!InvertTransform(transform, &inverse)) {
    return;
  }

  double cornersX[4];
  double cornersY[4];
  ApplyTransform(transform, x, y, &cornersX[0], &cornersY[0]);
  ApplyTransform(transform, x + width, y, &cornersX[1], &cornersY[1]);
  ApplyTransform(transform, x + width, y + height, &cornersX[2], &cornersY[2]);
  ApplyTransform(transform, x, y + height, &cornersX[3], &cornersY[3]);

  double minX = cornersX[0];
  double maxX = cornersX[0];
  double minY = cornersY[0];
  double maxY = cornersY[0];
  for (int i = 1; i < 4; ++i) {
    minX = std::min(minX, cornersX[i]);
    maxX = std::max(maxX, cornersX[i]);
    minY = std::min(minY, cornersY[i]);
    maxY = std::max(maxY, cornersY[i]);
  }

  const double transformScale = ApproximateTransformScale(transform);
  const double inset = std::max(1.0, strokeWeight / std::max(0.001, transformScale));
  const double sampleOffsets[4][2] = {
    {0.25, 0.25},
    {0.75, 0.25},
    {0.25, 0.75},
    {0.75, 0.75},
  };

  for (A_long py = static_cast<A_long>(std::floor(minY)); py <= static_cast<A_long>(std::ceil(maxY)); ++py) {
    for (A_long px = static_cast<A_long>(std::floor(minX)); px <= static_cast<A_long>(std::ceil(maxX)); ++px) {
      int strokeSamples = 0;
      int fillSamples = 0;
      for (int sample = 0; sample < 4; ++sample) {
        double localX = 0.0;
        double localY = 0.0;
        ApplyTransform(
          inverse,
          static_cast<double>(px) + sampleOffsets[sample][0],
          static_cast<double>(py) + sampleOffsets[sample][1],
          &localX,
          &localY
        );

        const bool inside =
          localX >= x && localX < x + width &&
          localY >= y && localY < y + height;
        if (!inside) {
          continue;
        }

        const bool onStroke =
          localX < x + inset ||
          localX >= x + width - inset ||
          localY < y + inset ||
          localY >= y + height - inset;

        if (onStroke && strokeColor) {
          strokeSamples += 1;
        } else if (fillColor) {
          fillSamples += 1;
        }
      }

      if (fillSamples > 0 && fillColor) {
        BlendPixel(
          output,
          px,
          py,
          *fillColor,
          static_cast<double>(fillSamples) / 4.0,
          fillErase,
          fillEraseStrength
        );
      }
      if (strokeSamples > 0 && strokeColor) {
        BlendPixel(
          output,
          px,
          py,
          *strokeColor,
          static_cast<double>(strokeSamples) / 4.0,
          strokeErase,
          strokeEraseStrength
        );
      }
    }
  }
}

template <typename PixelType>
void DrawLineAt(
  PF_LayerDef* output,
  const PixelType& color,
  double x1,
  double y1,
  double x2,
  double y2,
  double strokeWeight,
  int strokeCap,
  bool erase = false,
  double eraseStrength = 1.0
) {
  const double halfWidth = std::max(0.5, strokeWeight * 0.5);
  const double dx = x2 - x1;
  const double dy = y2 - y1;
  const double length = std::sqrt(dx * dx + dy * dy);
  const double extension = strokeCap == STROKE_CAP_PROJECT ? halfWidth : 0.0;
  const double minX = std::min(x1, x2) - halfWidth - extension - 1.0;
  const double maxX = std::max(x1, x2) + halfWidth + extension + 1.0;
  const double minY = std::min(y1, y2) - halfWidth - extension - 1.0;
  const double maxY = std::max(y1, y2) + halfWidth + extension + 1.0;

  for (A_long py = static_cast<A_long>(std::floor(minY)); py <= static_cast<A_long>(std::ceil(maxY)); ++py) {
    for (A_long px = static_cast<A_long>(std::floor(minX)); px <= static_cast<A_long>(std::ceil(maxX)); ++px) {
      const double sampleX = static_cast<double>(px) + 0.5;
      const double sampleY = static_cast<double>(py) + 0.5;

      double signedDistance = 0.0;
      if (length <= 1e-9) {
        const double ddx = sampleX - x1;
        const double ddy = sampleY - y1;
        signedDistance = std::sqrt(ddx * ddx + ddy * ddy) - halfWidth;
      } else {
        const double ux = dx / length;
        const double uy = dy / length;
        const double vx = sampleX - x1;
        const double vy = sampleY - y1;
        const double along = vx * ux + vy * uy;
        const double perp = vx * (-uy) + vy * ux;

        if (strokeCap == STROKE_CAP_ROUND) {
          const double clampedAlong = std::max(0.0, std::min(length, along));
          const double projectionX = x1 + ux * clampedAlong;
          const double projectionY = y1 + uy * clampedAlong;
          const double ddx = sampleX - projectionX;
          const double ddy = sampleY - projectionY;
          signedDistance = std::sqrt(ddx * ddx + ddy * ddy) - halfWidth;
        } else {
          const double halfSegment = (length + extension * 2.0) * 0.5;
          const double centerAlong = along - (length * 0.5);
          const double qx = std::fabs(centerAlong) - halfSegment;
          const double qy = std::fabs(perp) - halfWidth;
          const double ox = std::max(qx, 0.0);
          const double oy = std::max(qy, 0.0);
          signedDistance =
            std::sqrt(ox * ox + oy * oy) +
            std::min(std::max(qx, qy), 0.0);
        }
      }

      const double coverage = SampleCoverageAtPixel(px, py, [&](double sampleX, double sampleY) {
        double sampleDistance = 0.0;
        if (length <= 1e-9) {
          const double ddx = sampleX - x1;
          const double ddy = sampleY - y1;
          sampleDistance = std::sqrt(ddx * ddx + ddy * ddy) - halfWidth;
        } else {
          const double ux = dx / length;
          const double uy = dy / length;
          const double vx = sampleX - x1;
          const double vy = sampleY - y1;
          const double along = vx * ux + vy * uy;
          const double perp = vx * (-uy) + vy * ux;

          if (strokeCap == STROKE_CAP_ROUND) {
            const double clampedAlong = std::max(0.0, std::min(length, along));
            const double projectionX = x1 + ux * clampedAlong;
            const double projectionY = y1 + uy * clampedAlong;
            const double ddx = sampleX - projectionX;
            const double ddy = sampleY - projectionY;
            sampleDistance = std::sqrt(ddx * ddx + ddy * ddy) - halfWidth;
          } else {
            const double halfSegment = (length + extension * 2.0) * 0.5;
            const double centerAlong = along - (length * 0.5);
            const double qx = std::fabs(centerAlong) - halfSegment;
            const double qy = std::fabs(perp) - halfWidth;
            const double ox = std::max(qx, 0.0);
            const double oy = std::max(qy, 0.0);
            sampleDistance =
              std::sqrt(ox * ox + oy * oy) +
              std::min(std::max(qx, qy), 0.0);
          }
        }
        return CoverageFromSignedDistance(sampleDistance, kStrokeAaFeather);
      });
      if (coverage > 0.0) {
        BlendPixel(output, px, py, color, coverage, erase, eraseStrength);
      }
    }
  }
}

template <typename PixelType>
void DrawLineTransformedAt(
  PF_LayerDef* output,
  const PixelType& color,
  double x1,
  double y1,
  double x2,
  double y2,
  double strokeWeight,
  int strokeCap,
  const Transform2D& transform,
  bool erase = false,
  double eraseStrength = 1.0
) {
  double tx1 = 0.0;
  double ty1 = 0.0;
  double tx2 = 0.0;
  double ty2 = 0.0;
  ApplyTransform(transform, x1, y1, &tx1, &ty1);
  ApplyTransform(transform, x2, y2, &tx2, &ty2);
  DrawLineAt(
    output,
    color,
    tx1,
    ty1,
    tx2,
    ty2,
    std::max(1.0, strokeWeight * ApproximateTransformScale(transform)),
    strokeCap,
    erase,
    eraseStrength
  );
}

template <typename PixelType>
void DrawPointTransformedAt(
  PF_LayerDef* output,
  const PixelType& color,
  double x,
  double y,
  double strokeWeight,
  const Transform2D& transform,
  bool erase = false,
  double eraseStrength = 1.0
) {
  double tx = 0.0;
  double ty = 0.0;
  ApplyTransform(transform, x, y, &tx, &ty);
  const double radius = std::max(0.5, strokeWeight * ApproximateTransformScale(transform) * 0.5);
  DrawEllipseTransformedAt(
    output,
    static_cast<const PixelType*>(NULL),
    &color,
    tx,
    ty,
    radius,
    radius,
    strokeWeight,
    MakeIdentityTransform(),
    false,
    1.0,
    erase,
    eraseStrength
  );
}

template <typename PixelType>
void DrawRoundJoinAt(
  PF_LayerDef* output,
  const PixelType& color,
  double x,
  double y,
  double strokeWeight,
  bool erase = false,
  double eraseStrength = 1.0
) {
  const double radius = std::max(0.5, strokeWeight * 0.5);
  DrawEllipseTransformedAt(
    output,
    &color,
    &color,
    x,
    y,
    radius,
    radius,
    strokeWeight,
    MakeIdentityTransform(),
    erase,
    eraseStrength,
    erase,
    eraseStrength
  );
}

template <typename PixelType>
bool PointInPolygon(const std::vector<std::pair<double, double>>& vertices, double x, double y) {
  if (vertices.size() < 3) {
    return false;
  }

  bool inside = false;
  for (std::size_t i = 0, j = vertices.size() - 1; i < vertices.size(); j = i++) {
    const double xi = vertices[i].first;
    const double yi = vertices[i].second;
    const double xj = vertices[j].first;
    const double yj = vertices[j].second;
    const bool intersects =
      ((yi > y) != (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) == 0.0 ? 1e-9 : (yj - yi)) + xi);
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

template <typename PixelType>
bool PointInPolygonWithContours(
  const std::vector<std::pair<double, double>>& outerVertices,
  const std::vector<std::vector<std::pair<double, double>>>& contourVertices,
  double x,
  double y
) {
  bool inside = PointInPolygon<PixelType>(outerVertices, x, y);
  if (!inside) {
    return false;
  }

  for (std::size_t index = 0; index < contourVertices.size(); ++index) {
    if (PointInPolygon<PixelType>(contourVertices[index], x, y)) {
      inside = !inside;
    }
  }
  return inside;
}

double PolygonWithContoursCoverageAt(
  double px,
  double py,
  const std::vector<std::pair<double, double>>& outerVertices,
  const std::vector<std::vector<std::pair<double, double>>>& contourVertices
) {
  if (outerVertices.size() < 3) {
    return 0.0;
  }
  return SampleCoverageAroundPoint(px, py, [&](double sampleX, double sampleY) {
    return PointInPolygonWithContours<PF_Pixel>(
             outerVertices,
             contourVertices,
             sampleX,
             sampleY)
      ? 1.0
      : 0.0;
  });
}

double DistancePointToSegment(
  double px,
  double py,
  const std::pair<double, double>& start,
  const std::pair<double, double>& end
) {
  const double dx = end.first - start.first;
  const double dy = end.second - start.second;
  const double lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) {
    const double ddx = px - start.first;
    const double ddy = py - start.second;
    return std::sqrt(ddx * ddx + ddy * ddy);
  }

  const double t = std::max(
    0.0,
    std::min(
      1.0,
      ((px - start.first) * dx + (py - start.second) * dy) / lengthSquared
    )
  );
  const double projX = start.first + dx * t;
  const double projY = start.second + dy * t;
  const double ddx = px - projX;
  const double ddy = py - projY;
  return std::sqrt(ddx * ddx + ddy * ddy);
}

double SignedDistanceToButtSegment(
  double px,
  double py,
  const std::pair<double, double>& start,
  const std::pair<double, double>& end,
  double halfWidth
) {
  const double dx = end.first - start.first;
  const double dy = end.second - start.second;
  const double length = std::sqrt(dx * dx + dy * dy);
  if (length <= 1e-9) {
    const double ddx = px - start.first;
    const double ddy = py - start.second;
    return std::sqrt(ddx * ddx + ddy * ddy) - halfWidth;
  }

  const double ux = dx / length;
  const double uy = dy / length;
  const double vx = px - start.first;
  const double vy = py - start.second;
  const double along = vx * ux + vy * uy;
  const double perp = vx * (-uy) + vy * ux;
  const double centerAlong = along - length * 0.5;
  const double qx = std::fabs(centerAlong) - length * 0.5;
  const double qy = std::fabs(perp) - halfWidth;
  const double ox = std::max(qx, 0.0);
  const double oy = std::max(qy, 0.0);
  return std::sqrt(ox * ox + oy * oy) + std::min(std::max(qx, qy), 0.0);
}

bool PointInSimplePolygon(const std::vector<std::pair<double, double>>& vertices, double x, double y) {
  return PointInPolygon<PF_Pixel>(vertices, x, y);
}

bool IntersectLines(
  const std::pair<double, double>& p1,
  const std::pair<double, double>& d1,
  const std::pair<double, double>& p2,
  const std::pair<double, double>& d2,
  std::pair<double, double>* out
) {
  if (!out) {
    return false;
  }
  const double determinant = d1.first * d2.second - d1.second * d2.first;
  if (std::fabs(determinant) < 1e-9) {
    return false;
  }
  const double dx = p2.first - p1.first;
  const double dy = p2.second - p1.second;
  const double t = (dx * d2.second - dy * d2.first) / determinant;
  out->first = p1.first + d1.first * t;
  out->second = p1.second + d1.second * t;
  return true;
}

std::pair<double, double> AddScaled(
  const std::pair<double, double>& point,
  const std::pair<double, double>& vector,
  double scale
) {
  return std::make_pair(point.first + vector.first * scale, point.second + vector.second * scale);
}

VertexSpec MakePixelVertexSpec(double x, double y) {
  VertexSpec vertex;
  vertex.x = {"pixels", x};
  vertex.y = {"pixels", y};
  return vertex;
}

std::vector<VertexSpec> BuildRectVertexSpecs(
  double x,
  double y,
  double width,
  double height
) {
  std::vector<VertexSpec> vertices;
  vertices.reserve(4);
  vertices.push_back(MakePixelVertexSpec(x, y));
  vertices.push_back(MakePixelVertexSpec(x + width, y));
  vertices.push_back(MakePixelVertexSpec(x + width, y + height));
  vertices.push_back(MakePixelVertexSpec(x, y + height));
  return vertices;
}

std::vector<VertexSpec> BuildLineVertexSpecs(
  double x1,
  double y1,
  double x2,
  double y2
) {
  std::vector<VertexSpec> vertices;
  vertices.reserve(2);
  vertices.push_back(MakePixelVertexSpec(x1, y1));
  vertices.push_back(MakePixelVertexSpec(x2, y2));
  return vertices;
}

std::pair<double, double> Normalize(
  const std::pair<double, double>& vector
) {
  const double length = std::sqrt(vector.first * vector.first + vector.second * vector.second);
  if (length <= 1e-9) {
    return std::make_pair(0.0, 0.0);
  }
  return std::make_pair(vector.first / length, vector.second / length);
}

std::vector<std::pair<double, double>> BuildStrokeQuad(
  const std::pair<double, double>& start,
  const std::pair<double, double>& end,
  double halfWidth,
  double startExtension,
  double endExtension
) {
  std::vector<std::pair<double, double>> polygon;
  const std::pair<double, double> tangent = Normalize(
    std::make_pair(end.first - start.first, end.second - start.second)
  );
  if (std::fabs(tangent.first) < 1e-9 && std::fabs(tangent.second) < 1e-9) {
    return polygon;
  }

  const std::pair<double, double> normal = std::make_pair(-tangent.second, tangent.first);
  const std::pair<double, double> extendedStart = AddScaled(start, tangent, -startExtension);
  const std::pair<double, double> extendedEnd = AddScaled(end, tangent, endExtension);

  polygon.push_back(AddScaled(extendedStart, normal, halfWidth));
  polygon.push_back(AddScaled(extendedEnd, normal, halfWidth));
  polygon.push_back(AddScaled(extendedEnd, normal, -halfWidth));
  polygon.push_back(AddScaled(extendedStart, normal, -halfWidth));
  return polygon;
}

double CircleCoverageAt(double px, double py, double cx, double cy, double radius) {
  return SampleCoverageAroundPoint(px, py, [&](double sampleX, double sampleY) {
    const double dx = sampleX - cx;
    const double dy = sampleY - cy;
    const double signedDistance = std::sqrt(dx * dx + dy * dy) - radius;
    return CoverageFromSignedDistance(signedDistance, kStrokeAaFeather);
  });
}

double PolygonCoverageAt(double px, double py, const std::vector<std::pair<double, double>>& vertices) {
  if (vertices.size() < 3) {
    return 0.0;
  }
  return SampleCoverageAroundPoint(px, py, [&](double sampleX, double sampleY) {
    return PointInSimplePolygon(vertices, sampleX, sampleY) ? 1.0 : 0.0;
  });
}

double NormalizeAngleDelta(double delta, bool positive) {
  if (positive) {
    while (delta <= 0.0) {
      delta += M_PI * 2.0;
    }
  } else {
    while (delta >= 0.0) {
      delta -= M_PI * 2.0;
    }
  }
  return delta;
}

void AppendArcPoints(
  std::vector<std::pair<double, double>>* points,
  const std::pair<double, double>& center,
  double radius,
  double startAngle,
  double delta,
  bool includeFirst
) {
  if (!points || radius <= 0.0) {
    return;
  }

  const int steps = std::max(8, static_cast<int>(std::ceil(std::fabs(delta) / (M_PI / 16.0))));
  for (int index = includeFirst ? 0 : 1; index <= steps; ++index) {
    const double t = static_cast<double>(index) / static_cast<double>(steps);
    const double angle = startAngle + delta * t;
    points->push_back(std::make_pair(
      center.first + std::cos(angle) * radius,
      center.second + std::sin(angle) * radius
    ));
  }
}

bool ComputeOffsetIntersection(
  const std::pair<double, double>& current,
  const std::pair<double, double>& prevDir,
  const std::pair<double, double>& nextDir,
  double sideSign,
  double halfWidth,
  std::pair<double, double>* out
) {
  const std::pair<double, double> prevNormal = std::make_pair(-prevDir.second * sideSign, prevDir.first * sideSign);
  const std::pair<double, double> nextNormal = std::make_pair(-nextDir.second * sideSign, nextDir.first * sideSign);
  const std::pair<double, double> prevPoint = AddScaled(current, prevNormal, halfWidth);
  const std::pair<double, double> nextPoint = AddScaled(current, nextNormal, halfWidth);
  return IntersectLines(prevPoint, prevDir, nextPoint, nextDir, out);
}

void AppendBoundaryJoin(
  std::vector<std::pair<double, double>>* boundary,
  const std::pair<double, double>& current,
  const std::pair<double, double>& prevDir,
  const std::pair<double, double>& nextDir,
  double sideSign,
  double halfWidth,
  int strokeJoin
) {
  if (!boundary) {
    return;
  }

  const double cross = prevDir.first * nextDir.second - prevDir.second * nextDir.first;
  if (std::fabs(cross) < 1e-9) {
    const std::pair<double, double> nextNormal = std::make_pair(-nextDir.second * sideSign, nextDir.first * sideSign);
    boundary->push_back(AddScaled(current, nextNormal, halfWidth));
    return;
  }

  const std::pair<double, double> prevNormal = std::make_pair(-prevDir.second * sideSign, prevDir.first * sideSign);
  const std::pair<double, double> nextNormal = std::make_pair(-nextDir.second * sideSign, nextDir.first * sideSign);
  const std::pair<double, double> prevPoint = AddScaled(current, prevNormal, halfWidth);
  const std::pair<double, double> nextPoint = AddScaled(current, nextNormal, halfWidth);
  const bool outerJoin = cross * sideSign < 0.0;

  std::pair<double, double> intersection;
  const bool hasIntersection = ComputeOffsetIntersection(current, prevDir, nextDir, sideSign, halfWidth, &intersection);

  if (!outerJoin) {
    boundary->push_back(hasIntersection ? intersection : nextPoint);
    return;
  }

  if (strokeJoin == STROKE_JOIN_ROUND) {
    const double startAngle = std::atan2(prevNormal.second, prevNormal.first);
    const double endAngle = std::atan2(nextNormal.second, nextNormal.first);
    const double delta = NormalizeAngleDelta(endAngle - startAngle, cross > 0.0);
    AppendArcPoints(boundary, current, halfWidth, startAngle, delta, boundary->empty());
    return;
  }

  if (strokeJoin == STROKE_JOIN_MITER && hasIntersection) {
    const double miterDx = intersection.first - current.first;
    const double miterDy = intersection.second - current.second;
    const double miterLength = std::sqrt(miterDx * miterDx + miterDy * miterDy);
    const double miterLimit = halfWidth * 10.0;
    if (miterLength <= miterLimit) {
      boundary->push_back(intersection);
      return;
    }
  }

  boundary->push_back(prevPoint);
  boundary->push_back(nextPoint);
}

std::vector<std::pair<double, double>> BuildOpenStrokeOutlineInternal(
  const std::vector<std::pair<double, double>>& vertices,
  double halfWidth,
  int strokeCap,
  int strokeJoin
) {
  std::vector<std::pair<double, double>> outline;
  if (vertices.size() < 2) {
    return outline;
  }

  std::vector<std::pair<double, double>> directions;
  directions.reserve(vertices.size() - 1);
  for (std::size_t index = 0; index + 1 < vertices.size(); ++index) {
    directions.push_back(Normalize(std::make_pair(
      vertices[index + 1].first - vertices[index].first,
      vertices[index + 1].second - vertices[index].second
    )));
  }

  const std::pair<double, double> firstDir = directions.front();
  const std::pair<double, double> lastDir = directions.back();
  const std::pair<double, double> firstNormal = std::make_pair(-firstDir.second, firstDir.first);
  const std::pair<double, double> lastNormal = std::make_pair(-lastDir.second, lastDir.first);
  const double startExtension = strokeCap == STROKE_CAP_PROJECT ? halfWidth : 0.0;
  const double endExtension = strokeCap == STROKE_CAP_PROJECT ? halfWidth : 0.0;
  const std::pair<double, double> startBase = AddScaled(vertices.front(), firstDir, -startExtension);
  const std::pair<double, double> endBase = AddScaled(vertices.back(), lastDir, endExtension);

  std::vector<std::pair<double, double>> leftBoundary;
  std::vector<std::pair<double, double>> rightBoundary;
  leftBoundary.push_back(AddScaled(startBase, firstNormal, halfWidth));
  rightBoundary.push_back(AddScaled(startBase, firstNormal, -halfWidth));

  for (std::size_t index = 1; index + 1 < vertices.size(); ++index) {
    AppendBoundaryJoin(
      &leftBoundary,
      vertices[index],
      directions[index - 1],
      directions[index],
      1.0,
      halfWidth,
      strokeJoin
    );
    AppendBoundaryJoin(
      &rightBoundary,
      vertices[index],
      directions[index - 1],
      directions[index],
      -1.0,
      halfWidth,
      strokeJoin
    );
  }

  const std::pair<double, double> leftEnd = AddScaled(endBase, lastNormal, halfWidth);
  const std::pair<double, double> rightEnd = AddScaled(endBase, lastNormal, -halfWidth);
  leftBoundary.push_back(leftEnd);
  rightBoundary.push_back(rightEnd);

  outline.insert(outline.end(), leftBoundary.begin(), leftBoundary.end());

  if (strokeCap == STROKE_CAP_ROUND) {
    const double startAngle = std::atan2(lastNormal.second, lastNormal.first);
    AppendArcPoints(&outline, endBase, halfWidth, startAngle, -M_PI, false);
  } else {
    outline.push_back(rightEnd);
  }

  for (std::size_t index = rightBoundary.size(); index-- > 0;) {
    if (index == rightBoundary.size() - 1 && strokeCap != STROKE_CAP_ROUND) {
      continue;
    }
    outline.push_back(rightBoundary[index]);
  }

  if (strokeCap == STROKE_CAP_ROUND) {
    const double startAngle = std::atan2(-firstNormal.second, -firstNormal.first);
    AppendArcPoints(&outline, startBase, halfWidth, startAngle, -M_PI, false);
  }

  return outline;
}

double PolygonSignedArea(const std::vector<std::pair<double, double>>& vertices) {
  if (vertices.size() < 3) {
    return 0.0;
  }

  double area = 0.0;
  for (std::size_t index = 0; index < vertices.size(); ++index) {
    const std::pair<double, double>& current = vertices[index];
    const std::pair<double, double>& next = vertices[(index + 1) % vertices.size()];
    area += current.first * next.second - current.second * next.first;
  }
  return area * 0.5;
}

ClosedStrokeRing BuildClosedStrokeRingInternal(
  const std::vector<std::pair<double, double>>& vertices,
  double halfWidth,
  int strokeJoin
) {
  ClosedStrokeRing ring;
  if (vertices.size() < 3) {
    return ring;
  }

  std::vector<std::pair<double, double>> directions;
  directions.reserve(vertices.size());
  for (std::size_t index = 0; index < vertices.size(); ++index) {
    const std::pair<double, double>& current = vertices[index];
    const std::pair<double, double>& next = vertices[(index + 1) % vertices.size()];
    directions.push_back(Normalize(std::make_pair(
      next.first - current.first,
      next.second - current.second
    )));
  }

  const double signedArea = PolygonSignedArea(vertices);
  const double outerSideSign = signedArea >= 0.0 ? -1.0 : 1.0;

  ring.outer.reserve(vertices.size() * 2);
  ring.inner.reserve(vertices.size() * 2);

  for (std::size_t index = 0; index < vertices.size(); ++index) {
    const std::pair<double, double>& current = vertices[index];
    const std::pair<double, double>& prevDir = directions[(index + directions.size() - 1) % directions.size()];
    const std::pair<double, double>& nextDir = directions[index];

    AppendBoundaryJoin(
      &ring.outer,
      current,
      prevDir,
      nextDir,
      outerSideSign,
      halfWidth,
      strokeJoin
    );

    AppendBoundaryJoin(
      &ring.inner,
      current,
      prevDir,
      nextDir,
      -outerSideSign,
      halfWidth,
      strokeJoin
    );
  }

  return ring;
}

double JoinCoverageAt(
  double px,
  double py,
  const std::pair<double, double>& prev,
  const std::pair<double, double>& current,
  const std::pair<double, double>& next,
  double halfWidth,
  int strokeJoin
) {
  const double prevDx = current.first - prev.first;
  const double prevDy = current.second - prev.second;
  const double nextDx = next.first - current.first;
  const double nextDy = next.second - current.second;
  const double prevLength = std::sqrt(prevDx * prevDx + prevDy * prevDy);
  const double nextLength = std::sqrt(nextDx * nextDx + nextDy * nextDy);
  if (prevLength <= 1e-9 || nextLength <= 1e-9) {
    return 0.0;
  }

  const std::pair<double, double> uPrev = std::make_pair(prevDx / prevLength, prevDy / prevLength);
  const std::pair<double, double> uNext = std::make_pair(nextDx / nextLength, nextDy / nextLength);
  const double cross = uPrev.first * uNext.second - uPrev.second * uNext.first;
  if (std::fabs(cross) < 1e-9) {
    return 0.0;
  }

  // The join geometry needs to be constructed on the outer side of the turn.
  // For a left turn (positive cross), the outer edge is on the right side;
  // for a right turn, it is on the left side.
  const double side = cross > 0.0 ? -1.0 : 1.0;
  const std::pair<double, double> nPrev = std::make_pair(-uPrev.second * side, uPrev.first * side);
  const std::pair<double, double> nNext = std::make_pair(-uNext.second * side, uNext.first * side);
  const std::pair<double, double> outerP1 = AddScaled(current, nPrev, halfWidth);
  const std::pair<double, double> outerP2 = AddScaled(current, nNext, halfWidth);
  const std::pair<double, double> innerP1 = AddScaled(current, nPrev, -halfWidth);
  const std::pair<double, double> innerP2 = AddScaled(current, nNext, -halfWidth);

  double coverage = 0.0;

  // Fill the inside cusp so two stroked segments do not leave a visible seam.
  {
    std::vector<std::pair<double, double>> innerPolygon;
    innerPolygon.push_back(current);
    innerPolygon.push_back(innerP1);
    innerPolygon.push_back(innerP2);
    coverage = std::max(coverage, PolygonCoverageAt(px, py, innerPolygon));
  }

  if (strokeJoin == STROKE_JOIN_ROUND) {
    std::vector<std::pair<double, double>> roundPolygon;
    roundPolygon.push_back(current);
    const double startAngle = std::atan2(nPrev.second, nPrev.first);
    const double endAngle = std::atan2(nNext.second, nNext.first);
    double delta = endAngle - startAngle;
    if (side > 0.0) {
      while (delta <= 0.0) {
        delta += M_PI * 2.0;
      }
    } else {
      while (delta >= 0.0) {
        delta -= M_PI * 2.0;
      }
    }
    const int steps = std::max(8, static_cast<int>(std::ceil(std::fabs(delta) / (M_PI / 16.0))));
    for (int index = 0; index <= steps; ++index) {
      const double t = static_cast<double>(index) / static_cast<double>(steps);
      const double angle = startAngle + delta * t;
      roundPolygon.push_back(std::make_pair(
        current.first + std::cos(angle) * halfWidth,
        current.second + std::sin(angle) * halfWidth
      ));
    }
    coverage = std::max(coverage, PolygonCoverageAt(px, py, roundPolygon));
    return coverage;
  }

  std::vector<std::pair<double, double>> polygon;
  polygon.push_back(current);
  polygon.push_back(outerP1);

  if (strokeJoin == STROKE_JOIN_MITER) {
    std::pair<double, double> intersection;
    if (IntersectLines(outerP1, uPrev, outerP2, uNext, &intersection)) {
      const double miterDx = intersection.first - current.first;
      const double miterDy = intersection.second - current.second;
      const double miterLength = std::sqrt(miterDx * miterDx + miterDy * miterDy);
      const double miterLimit = halfWidth * 10.0;
      if (miterLength <= miterLimit) {
        polygon.push_back(intersection);
      }
    }
  }

  polygon.push_back(outerP2);
  coverage = std::max(coverage, PolygonCoverageAt(px, py, polygon));
  return coverage;
}

double CapCoverageAt(
  double px,
  double py,
  const std::pair<double, double>& point,
  const std::pair<double, double>& direction,
  double halfWidth,
  int strokeCap
) {
  if (strokeCap == STROKE_CAP_ROUND) {
    return CircleCoverageAt(px, py, point.first, point.second, halfWidth);
  }

  if (strokeCap == STROKE_CAP_PROJECT) {
    const std::pair<double, double> normal = std::make_pair(-direction.second, direction.first);
    std::vector<std::pair<double, double>> polygon;
    polygon.push_back(AddScaled(AddScaled(point, direction, -halfWidth), normal, halfWidth));
    polygon.push_back(AddScaled(AddScaled(point, direction, -halfWidth), normal, -halfWidth));
    polygon.push_back(AddScaled(AddScaled(point, direction, halfWidth), normal, -halfWidth));
    polygon.push_back(AddScaled(AddScaled(point, direction, halfWidth), normal, halfWidth));
    return PolygonCoverageAt(px, py, polygon);
  }

  return 0.0;
}

template <typename PixelType>
void DrawPathStrokeAt(
  PF_LayerDef* output,
  const PixelType& color,
  const std::vector<std::pair<double, double>>& vertices,
  bool closed,
  double strokeWeight,
  int strokeCap,
  int strokeJoin,
  double minX,
  double maxX,
  double minY,
  double maxY,
  bool erase = false,
  double eraseStrength = 1.0
) {
  if (vertices.size() < 2) {
    return;
  }

  const double halfWidth = std::max(0.5, strokeWeight * 0.5);
  const A_long startX = static_cast<A_long>(std::floor(minX - halfWidth - 2.0));
  const A_long endX = static_cast<A_long>(std::ceil(maxX + halfWidth + 2.0));
  const A_long startY = static_cast<A_long>(std::floor(minY - halfWidth - 2.0));
  const A_long endY = static_cast<A_long>(std::ceil(maxY + halfWidth + 2.0));

  if (!closed) {
    const std::vector<std::pair<double, double>> outline = BuildOpenStrokeOutlineInternal(
      vertices,
      halfWidth,
      strokeCap,
      strokeJoin
    );
    if (outline.size() >= 3) {
      for (A_long py = startY; py <= endY; ++py) {
        for (A_long px = startX; px <= endX; ++px) {
          double coverage = PolygonCoverageAt(
            static_cast<double>(px) + 0.5,
            static_cast<double>(py) + 0.5,
            outline
          );
          if (strokeJoin == STROKE_JOIN_ROUND && vertices.size() >= 3) {
            for (std::size_t index = 1; index + 1 < vertices.size(); ++index) {
              coverage = std::max(
                coverage,
                CircleCoverageAt(
                  static_cast<double>(px) + 0.5,
                  static_cast<double>(py) + 0.5,
                  vertices[index].first,
                  vertices[index].second,
                  halfWidth
                )
              );
            }
          }
          if (coverage > 0.0) {
            BlendPixel(output, px, py, color, coverage, erase, eraseStrength);
          }
        }
      }
      return;
    }
  }

  for (A_long py = startY; py <= endY; ++py) {
    for (A_long px = startX; px <= endX; ++px) {
      const double sampleX = static_cast<double>(px) + 0.5;
      const double sampleY = static_cast<double>(py) + 0.5;
      double coverage = 0.0;

      for (std::size_t index = 0; index + 1 < vertices.size(); ++index) {
        const bool hasPrev = index > 0 || closed;
        const bool hasNext = (index + 2) < vertices.size() || closed;
        const double startExtension = hasPrev ? halfWidth : (strokeCap == STROKE_CAP_PROJECT ? halfWidth : 0.0);
        const double endExtension = hasNext ? halfWidth : (strokeCap == STROKE_CAP_PROJECT ? halfWidth : 0.0);
        const std::vector<std::pair<double, double>> segmentQuad = BuildStrokeQuad(
          vertices[index],
          vertices[index + 1],
          halfWidth,
          startExtension,
          endExtension
        );
        if (!segmentQuad.empty()) {
          coverage = std::max(coverage, PolygonCoverageAt(sampleX, sampleY, segmentQuad));
        }
      }

      if (closed) {
        const std::vector<std::pair<double, double>> closingQuad = BuildStrokeQuad(
          vertices.back(),
          vertices.front(),
          halfWidth,
          halfWidth,
          halfWidth
        );
        if (!closingQuad.empty()) {
          coverage = std::max(coverage, PolygonCoverageAt(sampleX, sampleY, closingQuad));
        }
      } else if (strokeCap != STROKE_CAP_SQUARE) {
        const std::pair<double, double> startDir = std::make_pair(
          vertices[0].first - vertices[1].first,
          vertices[0].second - vertices[1].second
        );
        const std::pair<double, double> endDir = std::make_pair(
          vertices.back().first - vertices[vertices.size() - 2].first,
          vertices.back().second - vertices[vertices.size() - 2].second
        );
        const double startLength = std::sqrt(startDir.first * startDir.first + startDir.second * startDir.second);
        const double endLength = std::sqrt(endDir.first * endDir.first + endDir.second * endDir.second);
        if (startLength > 1e-9) {
          coverage = std::max(
            coverage,
            CapCoverageAt(
              sampleX,
              sampleY,
              vertices.front(),
              std::make_pair(startDir.first / startLength, startDir.second / startLength),
              halfWidth,
              strokeCap
            )
          );
        }
        if (endLength > 1e-9) {
          coverage = std::max(
            coverage,
            CapCoverageAt(
              sampleX,
              sampleY,
              vertices.back(),
              std::make_pair(endDir.first / endLength, endDir.second / endLength),
              halfWidth,
              strokeCap
            )
          );
        }
      }

      if (strokeJoin != STROKE_JOIN_BEVEL && strokeJoin != STROKE_JOIN_MITER && strokeJoin != STROKE_JOIN_ROUND) {
        strokeJoin = STROKE_JOIN_MITER;
      }

      if (vertices.size() >= 3) {
        if (closed) {
          for (std::size_t index = 0; index < vertices.size(); ++index) {
            const std::pair<double, double>& prev = vertices[(index + vertices.size() - 1) % vertices.size()];
            const std::pair<double, double>& current = vertices[index];
            const std::pair<double, double>& next = vertices[(index + 1) % vertices.size()];
            coverage = std::max(
              coverage,
              JoinCoverageAt(sampleX, sampleY, prev, current, next, halfWidth, strokeJoin)
            );
          }
        } else {
          for (std::size_t index = 1; index + 1 < vertices.size(); ++index) {
            coverage = std::max(
              coverage,
              JoinCoverageAt(sampleX, sampleY, vertices[index - 1], vertices[index], vertices[index + 1], halfWidth, strokeJoin)
            );
          }
        }
      }

      if (coverage > 0.0) {
        BlendPixel(output, px, py, color, coverage, erase, eraseStrength);
      }
    }
  }
}

template <typename PixelType>
void DrawClosedLoopStrokeAt(
  PF_LayerDef* output,
  const PixelType& color,
  const std::vector<std::pair<double, double>>& outerVertices,
  const std::vector<std::vector<std::pair<double, double>>>& contourVertices,
  double strokeWeight,
  int strokeJoin,
  double minX,
  double maxX,
  double minY,
  double maxY,
  bool erase = false,
  double eraseStrength = 1.0
) {
  const double halfWidth = std::max(0.5, strokeWeight * 0.5);
  const A_long startX = static_cast<A_long>(std::floor(minX - halfWidth - 2.0));
  const A_long endX = static_cast<A_long>(std::ceil(maxX + halfWidth + 2.0));
  const A_long startY = static_cast<A_long>(std::floor(minY - halfWidth - 2.0));
  const A_long endY = static_cast<A_long>(std::ceil(maxY + halfWidth + 2.0));

  auto drawRing = [&](const ClosedStrokeRing& ring) {
    if (ring.outer.size() < 3 || ring.inner.size() < 3) {
      return;
    }
    std::vector<std::vector<std::pair<double, double>>> innerContours(1);
    innerContours[0] = ring.inner;
    for (A_long py = startY; py <= endY; ++py) {
      for (A_long px = startX; px <= endX; ++px) {
        const double coverage = PolygonWithContoursCoverageAt(
          static_cast<double>(px) + 0.5,
          static_cast<double>(py) + 0.5,
          ring.outer,
          innerContours
        );
        if (coverage > 0.0) {
          BlendPixel(output, px, py, color, coverage, erase, eraseStrength);
        }
      }
    }
  };

  drawRing(BuildClosedStrokeRingInternal(outerVertices, halfWidth, strokeJoin));
  for (std::size_t contourIndex = 0; contourIndex < contourVertices.size(); ++contourIndex) {
    drawRing(BuildClosedStrokeRingInternal(contourVertices[contourIndex], halfWidth, strokeJoin));
  }
}

template <typename PixelType>
void DrawPolygonTransformedAt(
  PF_LayerDef* output,
  const PixelType* fillColor,
  const PixelType* strokeColor,
  const std::vector<VertexSpec>& vertices,
  const std::vector<std::vector<VertexSpec>>& contours,
  bool closePath,
  double strokeWeight,
  int strokeCap,
  int strokeJoin,
  const Transform2D& transform,
  bool fillErase,
  double fillEraseStrength,
  bool strokeErase,
  double strokeEraseStrength
);

struct FlattenedPathSubpath {
  std::vector<std::pair<double, double>> vertices;
  bool closed = false;
  bool isContour = false;
};

double DistanceSquaredToSegment(
  const std::pair<double, double>& point,
  const std::pair<double, double>& start,
  const std::pair<double, double>& end
) {
  const double dx = end.first - start.first;
  const double dy = end.second - start.second;
  const double lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) {
    const double px = point.first - start.first;
    const double py = point.second - start.second;
    return px * px + py * py;
  }
  const double t = std::max(0.0, std::min(1.0,
    ((point.first - start.first) * dx + (point.second - start.second) * dy) / lengthSquared
  ));
  const double projX = start.first + dx * t;
  const double projY = start.second + dy * t;
  const double offX = point.first - projX;
  const double offY = point.second - projY;
  return offX * offX + offY * offY;
}

void FlattenQuadraticRecursive(
  std::vector<std::pair<double, double>>* vertices,
  const std::pair<double, double>& p0,
  const std::pair<double, double>& c,
  const std::pair<double, double>& p1,
  double toleranceSquared,
  int depth
) {
  if (!vertices) {
    return;
  }
  const double deviation = DistanceSquaredToSegment(c, p0, p1);
  if (deviation <= toleranceSquared || depth >= 12) {
    vertices->push_back(p1);
    return;
  }

  const std::pair<double, double> p0c = std::make_pair((p0.first + c.first) * 0.5, (p0.second + c.second) * 0.5);
  const std::pair<double, double> cp1 = std::make_pair((c.first + p1.first) * 0.5, (c.second + p1.second) * 0.5);
  const std::pair<double, double> mid = std::make_pair((p0c.first + cp1.first) * 0.5, (p0c.second + cp1.second) * 0.5);
  FlattenQuadraticRecursive(vertices, p0, p0c, mid, toleranceSquared, depth + 1);
  FlattenQuadraticRecursive(vertices, mid, cp1, p1, toleranceSquared, depth + 1);
}

void FlattenCubicRecursive(
  std::vector<std::pair<double, double>>* vertices,
  const std::pair<double, double>& p0,
  const std::pair<double, double>& c1,
  const std::pair<double, double>& c2,
  const std::pair<double, double>& p1,
  double toleranceSquared,
  int depth
) {
  if (!vertices) {
    return;
  }
  const double deviation = std::max(
    DistanceSquaredToSegment(c1, p0, p1),
    DistanceSquaredToSegment(c2, p0, p1)
  );
  if (deviation <= toleranceSquared || depth >= 12) {
    vertices->push_back(p1);
    return;
  }

  const std::pair<double, double> p01 = std::make_pair((p0.first + c1.first) * 0.5, (p0.second + c1.second) * 0.5);
  const std::pair<double, double> p12 = std::make_pair((c1.first + c2.first) * 0.5, (c1.second + c2.second) * 0.5);
  const std::pair<double, double> p23 = std::make_pair((c2.first + p1.first) * 0.5, (c2.second + p1.second) * 0.5);
  const std::pair<double, double> p012 = std::make_pair((p01.first + p12.first) * 0.5, (p01.second + p12.second) * 0.5);
  const std::pair<double, double> p123 = std::make_pair((p12.first + p23.first) * 0.5, (p12.second + p23.second) * 0.5);
  const std::pair<double, double> mid = std::make_pair((p012.first + p123.first) * 0.5, (p012.second + p123.second) * 0.5);
  FlattenCubicRecursive(vertices, p0, p01, p012, mid, toleranceSquared, depth + 1);
  FlattenCubicRecursive(vertices, mid, p123, p23, p1, toleranceSquared, depth + 1);
}

std::pair<double, double> ResolveAndTransformPoint(
  PF_LayerDef* output,
  const Transform2D& transform,
  const VertexSpec& vertex
) {
  double tx = 0.0;
  double ty = 0.0;
  ApplyTransform(
    transform,
    ResolveScalarSpec(vertex.x, output),
    ResolveScalarSpec(vertex.y, output),
    &tx,
    &ty
  );
  return std::make_pair(tx, ty);
}

FlattenedPathSubpath FlattenPathSubpath(
  PF_LayerDef* output,
  const Transform2D& transform,
  const PathSubpath& source
) {
  FlattenedPathSubpath flattened;
  flattened.isContour = source.isContour;
  if (!output) {
    return flattened;
  }

  constexpr double kPathFlatnessTolerance = 0.35;
  const double toleranceSquared = kPathFlatnessTolerance * kPathFlatnessTolerance;
  std::pair<double, double> current(0.0, 0.0);
  std::pair<double, double> start(0.0, 0.0);
  bool hasCurrent = false;

  for (std::size_t index = 0; index < source.segments.size(); ++index) {
    const PathSegment& segment = source.segments[index];
    switch (segment.type) {
      case PATH_SEGMENT_MOVE_TO: {
        current = ResolveAndTransformPoint(output, transform, segment.point);
        start = current;
        flattened.vertices.push_back(current);
        hasCurrent = true;
        break;
      }
      case PATH_SEGMENT_LINE_TO: {
        if (!hasCurrent) {
          current = ResolveAndTransformPoint(output, transform, segment.point);
          start = current;
          flattened.vertices.push_back(current);
          hasCurrent = true;
          break;
        }
        current = ResolveAndTransformPoint(output, transform, segment.point);
        flattened.vertices.push_back(current);
        break;
      }
      case PATH_SEGMENT_QUADRATIC_TO: {
        if (!hasCurrent) {
          break;
        }
        const std::pair<double, double> control = ResolveAndTransformPoint(output, transform, segment.control1);
        const std::pair<double, double> endpoint = ResolveAndTransformPoint(output, transform, segment.point);
        FlattenQuadraticRecursive(&flattened.vertices, current, control, endpoint, toleranceSquared, 0);
        current = endpoint;
        break;
      }
      case PATH_SEGMENT_CUBIC_TO: {
        if (!hasCurrent) {
          break;
        }
        const std::pair<double, double> control1 = ResolveAndTransformPoint(output, transform, segment.control1);
        const std::pair<double, double> control2 = ResolveAndTransformPoint(output, transform, segment.control2);
        const std::pair<double, double> endpoint = ResolveAndTransformPoint(output, transform, segment.point);
        FlattenCubicRecursive(&flattened.vertices, current, control1, control2, endpoint, toleranceSquared, 0);
        current = endpoint;
        break;
      }
      case PATH_SEGMENT_CLOSE:
        flattened.closed = true;
        current = start;
        break;
      default:
        break;
    }
  }

  return flattened;
}

std::vector<VertexSpec> PairsToVertexSpecs(const std::vector<std::pair<double, double>>& points) {
  std::vector<VertexSpec> vertices;
  vertices.reserve(points.size());
  for (std::size_t index = 0; index < points.size(); ++index) {
    vertices.push_back(MakePixelVertexSpec(points[index].first, points[index].second));
  }
  return vertices;
}

template <typename PixelType>
void DrawPathTransformedAt(
  PF_LayerDef* output,
  const PixelType* fillColor,
  const PixelType* strokeColor,
  const VectorPath& path,
  double strokeWeight,
  int strokeCap,
  int strokeJoin,
  const Transform2D& transform,
  bool fillErase,
  double fillEraseStrength,
  bool strokeErase,
  double strokeEraseStrength
) {
  if (!output || path.subpaths.empty()) {
    return;
  }

  std::vector<FlattenedPathSubpath> flattened;
  flattened.reserve(path.subpaths.size());
  for (std::size_t index = 0; index < path.subpaths.size(); ++index) {
    FlattenedPathSubpath subpath = FlattenPathSubpath(output, transform, path.subpaths[index]);
    if (!subpath.vertices.empty()) {
      flattened.push_back(subpath);
    }
  }
  if (flattened.empty()) {
    return;
  }

  const Transform2D identity = MakeIdentityTransform();
  for (std::size_t index = 0; index < flattened.size(); ++index) {
    const FlattenedPathSubpath& subpath = flattened[index];
    if (subpath.closed && !subpath.isContour && subpath.vertices.size() >= 3) {
      std::vector<std::vector<VertexSpec>> contourSpecs;
      std::size_t contourIndex = index + 1;
      for (; contourIndex < flattened.size(); ++contourIndex) {
        const FlattenedPathSubpath& contour = flattened[contourIndex];
        if (!contour.isContour || !contour.closed || contour.vertices.size() < 3) {
          break;
        }
        contourSpecs.push_back(PairsToVertexSpecs(contour.vertices));
      }

      DrawPolygonTransformedAt(
        output,
        fillColor,
        strokeColor,
        PairsToVertexSpecs(subpath.vertices),
        contourSpecs,
        true,
        strokeWeight,
        strokeCap,
        strokeJoin,
        identity,
        fillErase,
        fillEraseStrength,
        strokeErase,
        strokeEraseStrength
      );
      index = contourIndex - 1;
      continue;
    }

    if (subpath.vertices.size() == 1) {
      if (strokeColor) {
        DrawPointTransformedAt(
          output,
          *strokeColor,
          subpath.vertices[0].first,
          subpath.vertices[0].second,
          strokeWeight,
          identity,
          strokeErase,
          strokeEraseStrength
        );
      }
      continue;
    }

    if (subpath.vertices.size() >= 2 && strokeColor) {
      DrawPolygonTransformedAt(
        output,
        static_cast<const PixelType*>(NULL),
        strokeColor,
        PairsToVertexSpecs(subpath.vertices),
        std::vector<std::vector<VertexSpec>>(),
        subpath.closed,
        strokeWeight,
        strokeCap,
        strokeJoin,
        identity,
        false,
        1.0,
        strokeErase,
        strokeEraseStrength
      );
    }
  }
}

template <typename PixelType>
void DrawPolygonTransformedAt(
  PF_LayerDef* output,
  const PixelType* fillColor,
  const PixelType* strokeColor,
  const std::vector<VertexSpec>& vertices,
  const std::vector<std::vector<VertexSpec>>& contours,
  bool closePath,
  double strokeWeight,
  int strokeCap,
  int strokeJoin,
  const Transform2D& transform,
  bool fillErase,
  double fillEraseStrength,
  bool strokeErase,
  double strokeEraseStrength
) {
  if (vertices.empty()) {
    return;
  }

  std::vector<std::pair<double, double>> transformedVertices;
  std::vector<std::vector<std::pair<double, double>>> transformedContours;
  transformedVertices.reserve(vertices.size());
  transformedContours.reserve(contours.size());
  double minX = 0.0;
  double maxX = 0.0;
  double minY = 0.0;
  double maxY = 0.0;

  for (std::size_t index = 0; index < vertices.size(); index += 1) {
    double tx = 0.0;
    double ty = 0.0;
    ApplyTransform(transform, vertices[index].x.value, vertices[index].y.value, &tx, &ty);
    transformedVertices.push_back(std::make_pair(tx, ty));
    if (index == 0) {
      minX = maxX = tx;
      minY = maxY = ty;
    } else {
      minX = std::min(minX, tx);
      maxX = std::max(maxX, tx);
      minY = std::min(minY, ty);
      maxY = std::max(maxY, ty);
    }
  }

  for (std::size_t contourIndex = 0; contourIndex < contours.size(); ++contourIndex) {
    const std::vector<VertexSpec>& contour = contours[contourIndex];
    if (contour.size() < 3) {
      continue;
    }
    std::vector<std::pair<double, double>> transformedContour;
    transformedContour.reserve(contour.size());
    for (std::size_t vertexIndex = 0; vertexIndex < contour.size(); ++vertexIndex) {
      double tx = 0.0;
      double ty = 0.0;
      ApplyTransform(transform, contour[vertexIndex].x.value, contour[vertexIndex].y.value, &tx, &ty);
      transformedContour.push_back(std::make_pair(tx, ty));
      minX = std::min(minX, tx);
      maxX = std::max(maxX, tx);
      minY = std::min(minY, ty);
      maxY = std::max(maxY, ty);
    }
    transformedContours.push_back(transformedContour);
  }

  if (fillColor && transformedVertices.size() >= 3) {
    for (A_long py = static_cast<A_long>(std::floor(minY)); py <= static_cast<A_long>(std::ceil(maxY)); ++py) {
      for (A_long px = static_cast<A_long>(std::floor(minX)); px <= static_cast<A_long>(std::ceil(maxX)); ++px) {
        const double coverage = SampleCoverageAtPixel(px, py, [&](double sampleX, double sampleY) {
          return PointInPolygonWithContours<PixelType>(
                   transformedVertices,
                   transformedContours,
                   sampleX,
                   sampleY)
            ? 1.0
            : 0.0;
        });

        if (coverage > 0.0) {
          BlendPixel(
            output,
            px,
            py,
            *fillColor,
            coverage,
            fillErase,
            fillEraseStrength
          );
        }
      }
    }
  }

  if (strokeColor && transformedVertices.size() >= 2) {
    if (closePath) {
      DrawClosedLoopStrokeAt(
        output,
        *strokeColor,
        transformedVertices,
        transformedContours,
        strokeWeight,
        strokeJoin,
        minX,
        maxX,
        minY,
        maxY,
        strokeErase,
        strokeEraseStrength
      );
    } else {
      DrawPathStrokeAt(
        output,
        *strokeColor,
        transformedVertices,
        false,
        strokeWeight,
        strokeCap,
        strokeJoin,
        minX,
        maxX,
        minY,
        maxY,
        strokeErase,
        strokeEraseStrength
      );
    }
  }
}

template <typename PixelType>
void DrawDiagnosticImpl(PF_LayerDef* output, const PixelType& background, const PixelType& accent) {
  FillBackground(output, background);

  const double width = static_cast<double>(output->width);
  const double height = static_cast<double>(output->height);
  const double insetX = width * 0.18;
  const double insetY = height * 0.18;

  DrawRectAt(
    output,
    static_cast<const PixelType*>(NULL),
    &accent,
    insetX,
    insetY,
    width - insetX * 2.0,
    height - insetY * 2.0,
    8.0
  );
  DrawLineAt(output, accent, insetX, insetY, width - insetX, height - insetY, 8.0, STROKE_CAP_ROUND);
  DrawLineAt(output, accent, width - insetX, insetY, insetX, height - insetY, 8.0, STROKE_CAP_ROUND);
}

bool IsDrawableCommand(const SceneCommand& command) {
  return
    command.type == "point" ||
    command.type == "line" ||
    command.type == "path" ||
    command.type == "text" ||
    command.type == "image";
}

bool IsIdentityTransformValue(const Transform2D& transform) {
  return
    std::fabs(transform.a - 1.0) <= 1e-6 &&
    std::fabs(transform.b) <= 1e-6 &&
    std::fabs(transform.c) <= 1e-6 &&
    std::fabs(transform.d - 1.0) <= 1e-6 &&
    std::fabs(transform.tx) <= 1e-6 &&
    std::fabs(transform.ty) <= 1e-6;
}

template <typename PixelType>
PixelType ToRenderPixel(const PF_Pixel& color);

template <>
PF_Pixel ToRenderPixel<PF_Pixel>(const PF_Pixel& color) {
  return color;
}

template <>
PF_Pixel16 ToRenderPixel<PF_Pixel16>(const PF_Pixel& color) {
  return ToPixel16(color);
}

template <typename PixelType>
PixelType TransparentPixel();

template <>
PF_Pixel TransparentPixel<PF_Pixel>() {
  return PF_Pixel{0, 0, 0, 0};
}

template <>
PF_Pixel16 TransparentPixel<PF_Pixel16>() {
  return PF_Pixel16{0, 0, 0, 0};
}

PF_Pixel ApplyTintToPixel(const PF_Pixel& pixel, const PF_Pixel& tint) {
  return PF_Pixel{
    static_cast<A_u_char>(std::round((static_cast<double>(pixel.alpha) * tint.alpha) / 255.0)),
    static_cast<A_u_char>(std::round((static_cast<double>(pixel.red) * tint.red) / 255.0)),
    static_cast<A_u_char>(std::round((static_cast<double>(pixel.green) * tint.green) / 255.0)),
    static_cast<A_u_char>(std::round((static_cast<double>(pixel.blue) * tint.blue) / 255.0))
  };
}

template <typename PixelType>
void RenderDrawableCommand(PF_LayerDef* output, const ScenePayload& scene, const SceneCommand& command) {
  if (!output) {
    return;
  }

  if (command.type == "point" && command.hasStroke) {
    const PixelType strokeColor = ToRenderPixel<PixelType>(command.stroke);
    DrawPointTransformedAt(
      output,
      strokeColor,
      ResolveScalarSpec(command.x, output),
      ResolveScalarSpec(command.y, output),
      command.strokeWeight,
      command.transform,
      command.eraseStroke,
      command.eraseStrokeStrength
    );
  } else if (command.type == "line" && command.hasStroke) {
    const PixelType strokeColor = ToRenderPixel<PixelType>(command.stroke);
    DrawLineTransformedAt(
      output,
      strokeColor,
      ResolveScalarSpec(command.x1, output),
      ResolveScalarSpec(command.y1, output),
      ResolveScalarSpec(command.x2, output),
      ResolveScalarSpec(command.y2, output),
      command.strokeWeight,
      command.strokeCap,
      command.transform,
      command.eraseStroke,
      command.eraseStrokeStrength
    );
  } else if (command.type == "path" && (command.hasFill || command.hasStroke)) {
    const PixelType fillColor = ToRenderPixel<PixelType>(command.fill);
    const PixelType strokeColor = ToRenderPixel<PixelType>(command.stroke);
    DrawPathTransformedAt(
      output,
      command.hasFill ? &fillColor : NULL,
      command.hasStroke ? &strokeColor : NULL,
      command.path,
      command.strokeWeight,
      command.strokeCap,
      command.strokeJoin,
      command.transform,
      command.eraseFill,
      command.eraseFillStrength,
      command.eraseStroke,
      command.eraseStrokeStrength
    );
  } else if (command.type == "text" && (command.hasFill || command.hasStroke)) {
    RasterizedText rasterized;
    if (!RasterizeTextCommand(command, &rasterized)) {
      return;
    }

    const PixelType fillColor = ToRenderPixel<PixelType>(command.fill);
    const PixelType strokeColor = ToRenderPixel<PixelType>(command.stroke);
    const A_long originX = static_cast<A_long>(std::floor(rasterized.originX));
    const A_long originY = static_cast<A_long>(std::floor(rasterized.originY));

    for (int y = 0; y < rasterized.height; ++y) {
      for (int x = 0; x < rasterized.width; ++x) {
        const std::size_t index = static_cast<std::size_t>(y * rasterized.width + x);
        if (command.hasFill && index < rasterized.fillAlpha.size() && rasterized.fillAlpha[index] > 0) {
          BlendPixel(
            output,
            originX + x,
            originY + y,
            fillColor,
            static_cast<double>(rasterized.fillAlpha[index]) / 255.0,
            command.eraseFill,
            command.eraseFillStrength
          );
        }
        if (command.hasStroke && index < rasterized.strokeAlpha.size() && rasterized.strokeAlpha[index] > 0) {
          BlendPixel(
            output,
            originX + x,
            originY + y,
            strokeColor,
            static_cast<double>(rasterized.strokeAlpha[index]) / 255.0,
            command.eraseStroke,
            command.eraseStrokeStrength
          );
        }
      }
    }
  } else if (command.type == "image" && command.imageId > 0) {
    const auto imageIt = scene.imageAssets.find(command.imageId);
    if (imageIt == scene.imageAssets.end() || !imageIt->second.loaded || imageIt->second.width <= 0 ||
        imageIt->second.height <= 0 || imageIt->second.pixels.empty()) {
      return;
    }

    const RuntimeImageAsset& asset = imageIt->second;
    double srcX = 0.0;
    double srcY = 0.0;
    double srcWidth = static_cast<double>(asset.width);
    double srcHeight = static_cast<double>(asset.height);
    if (command.imageHasSourceRect) {
      srcX = command.imageSourceX;
      srcY = command.imageSourceY;
      srcWidth = command.imageSourceWidth;
      srcHeight = command.imageSourceHeight;
    }
    if (!(command.width.value > 0.0) || !(command.height.value > 0.0) ||
        !(srcWidth > 0.0) || !(srcHeight > 0.0)) {
      return;
    }

    double cornersX[4] = {
      command.x.value,
      command.x.value + command.width.value,
      command.x.value + command.width.value,
      command.x.value
    };
    double cornersY[4] = {
      command.y.value,
      command.y.value,
      command.y.value + command.height.value,
      command.y.value + command.height.value
    };
    double minX = std::numeric_limits<double>::infinity();
    double minY = std::numeric_limits<double>::infinity();
    double maxX = -std::numeric_limits<double>::infinity();
    double maxY = -std::numeric_limits<double>::infinity();
    for (int i = 0; i < 4; ++i) {
      double tx = 0.0;
      double ty = 0.0;
      ApplyTransform(command.transform, cornersX[i], cornersY[i], &tx, &ty);
      minX = std::min(minX, tx);
      minY = std::min(minY, ty);
      maxX = std::max(maxX, tx);
      maxY = std::max(maxY, ty);
    }

    Transform2D inverse;
    if (!InvertTransform(command.transform, &inverse)) {
      return;
    }

    const A_long startX = std::max<A_long>(0, static_cast<A_long>(std::floor(minX)));
    const A_long startY = std::max<A_long>(0, static_cast<A_long>(std::floor(minY)));
    const A_long endX = std::min(output->width, static_cast<A_long>(std::ceil(maxX)));
    const A_long endY = std::min(output->height, static_cast<A_long>(std::ceil(maxY)));
    for (A_long py = startY; py < endY; ++py) {
      for (A_long px = startX; px < endX; ++px) {
        double localX = 0.0;
        double localY = 0.0;
        ApplyTransform(inverse, static_cast<double>(px) + 0.5, static_cast<double>(py) + 0.5, &localX, &localY);
        if (
          localX < command.x.value ||
          localY < command.y.value ||
          localX > command.x.value + command.width.value ||
          localY > command.y.value + command.height.value) {
          continue;
        }

        const double u = (localX - command.x.value) / command.width.value;
        const double v = (localY - command.y.value) / command.height.value;
        const double sampleX = srcX + u * srcWidth - 0.5;
        const double sampleY = srcY + v * srcHeight - 0.5;
        PF_Pixel sampled = SampleImagePixelBilinear(asset, sampleX, sampleY);
        if (command.imageHasTint) {
          sampled = ApplyTintToPixel(sampled, command.imageTint);
        }
        const PixelType renderPixel = ToRenderPixel<PixelType>(sampled);
        BlendPixel(output, px, py, renderPixel, 1.0, false, 1.0);
      }
    }
  }
}

std::vector<double> BuildClipMask(
  const std::vector<SceneCommand>& commands,
  PF_LayerDef* output
) {
  std::vector<double> clipMask;
  if (!output || output->width <= 0 || output->height <= 0) {
    return clipMask;
  }

  std::vector<PF_Pixel> maskPixels(
    static_cast<std::size_t>(output->width * output->height),
    PF_Pixel{0, 0, 0, 0}
  );
  PF_LayerDef maskSurface = MakeSurface8(output->width, output->height, &maskPixels);

  const RenderCommandState previousState = g_renderCommandState;
  g_renderCommandState.clipMask = NULL;
  g_renderCommandState.blendMode = BLEND_MODE_BLEND;

  for (std::size_t i = 0; i < commands.size(); ++i) {
    const SceneCommand& command = commands[i];
    if (!command.clipPath || !IsDrawableCommand(command)) {
      continue;
    }

    SceneCommand maskCommand = command;
    maskCommand.blendMode = BLEND_MODE_BLEND;
    maskCommand.eraseFill = false;
    maskCommand.eraseStroke = false;
    maskCommand.eraseFillStrength = 1.0;
    maskCommand.eraseStrokeStrength = 1.0;
    if (maskCommand.hasFill) {
      maskCommand.fill = PF_Pixel{255, 255, 255, 255};
    }
    if (maskCommand.hasStroke) {
      maskCommand.stroke = PF_Pixel{255, 255, 255, 255};
    }
    RenderDrawableCommand<PF_Pixel>(&maskSurface, ScenePayload(), maskCommand);
  }

  g_renderCommandState = previousState;

  clipMask.resize(maskPixels.size(), 0.0);
  for (std::size_t i = 0; i < maskPixels.size(); ++i) {
    clipMask[i] = ClampUnit(static_cast<double>(maskPixels[i].alpha) / 255.0);
  }
  return clipMask;
}

void IntersectClipMask(
  std::vector<double>* currentClipMask,
  const std::vector<double>& nextMask,
  bool invert
) {
  if (!currentClipMask || nextMask.empty()) {
    return;
  }

  if (currentClipMask->empty()) {
    currentClipMask->resize(nextMask.size(), 1.0);
  }

  for (std::size_t i = 0; i < nextMask.size(); ++i) {
    const double nextValue = invert ? (1.0 - nextMask[i]) : nextMask[i];
    (*currentClipMask)[i] = ClampUnit((*currentClipMask)[i] * ClampUnit(nextValue));
  }
}

template <typename PixelType>
void RenderSceneImpl(
  PF_LayerDef* output,
  const ScenePayload& scene,
  std::size_t startCommandIndex = 0,
  std::size_t endCommandIndex = std::numeric_limits<std::size_t>::max()
) {
  std::vector<double> currentClipMask;
  std::vector<std::vector<double>> clipMaskStack;
  std::vector<std::size_t> clipBeginIndices;
  std::vector<bool> clipInvertStack;

  const RenderCommandState previousState = g_renderCommandState;
  g_renderCommandState.clipMask = NULL;
  g_renderCommandState.blendMode = BLEND_MODE_BLEND;

  const std::size_t startIndex = std::min(startCommandIndex, scene.commands.size());
  const std::size_t stopIndex = std::min(endCommandIndex, scene.commands.size());
  for (std::size_t i = startIndex; i < stopIndex; ++i) {
    const SceneCommand& command = scene.commands[i];

    if (command.type == "push_state") {
      clipMaskStack.push_back(currentClipMask);
      continue;
    }

    if (command.type == "pop_state") {
      if (!clipMaskStack.empty()) {
        currentClipMask = clipMaskStack.back();
        clipMaskStack.pop_back();
      }
      continue;
    }

    if (command.type == "clip_begin") {
      clipBeginIndices.push_back(i);
      clipInvertStack.push_back(command.clipInvert);
      continue;
    }

    if (command.type == "clip_end") {
      if (!clipBeginIndices.empty()) {
        const std::size_t beginIndex = clipBeginIndices.back();
        const bool invert = clipInvertStack.back();
        clipBeginIndices.pop_back();
        clipInvertStack.pop_back();

        std::vector<SceneCommand> clipCommands;
        clipCommands.reserve(i > beginIndex ? (i - beginIndex - 1) : 0);
        for (std::size_t clipIndex = beginIndex + 1; clipIndex < i; ++clipIndex) {
          if (scene.commands[clipIndex].clipPath) {
            clipCommands.push_back(scene.commands[clipIndex]);
          }
        }
        IntersectClipMask(&currentClipMask, BuildClipMask(clipCommands, output), invert);
      }
      continue;
    }

    if (command.type == "clear") {
      FillBackground(output, TransparentPixel<PixelType>());
      continue;
    }

    if (command.type == "background") {
      const double sceneWidth = GetSceneWidth(scene, output);
      const double sceneHeight = GetSceneHeight(scene, output);
      if (!(sceneWidth > 0.0) || !(sceneHeight > 0.0)) {
        continue;
      }
      SceneCommand backgroundCommand = command;
      g_renderCommandState.clipMask = currentClipMask.empty() ? NULL : &currentClipMask;
      g_renderCommandState.blendMode =
        backgroundCommand.blendMode == BLEND_MODE_REPLACE
          ? BLEND_MODE_BLEND
          : backgroundCommand.blendMode;
      if (backgroundCommand.blendMode == BLEND_MODE_REPLACE) {
        FillBackground(output, TransparentPixel<PixelType>());
      }
      const PixelType fillColor = ToRenderPixel<PixelType>(backgroundCommand.fill);
      DrawRectTransformedAt(
        output,
        &fillColor,
        static_cast<const PixelType*>(NULL),
        0.0,
        0.0,
        sceneWidth,
        sceneHeight,
        1.0,
        MakeIdentityTransform(),
        backgroundCommand.eraseFill,
        backgroundCommand.eraseFillStrength,
        false,
        1.0
      );
      continue;
    }

    if (command.clipPath || !IsDrawableCommand(command)) {
      continue;
    }

    g_renderCommandState.clipMask = currentClipMask.empty() ? NULL : &currentClipMask;
    g_renderCommandState.blendMode =
      command.blendMode == BLEND_MODE_REPLACE ? BLEND_MODE_BLEND : command.blendMode;
    if (command.blendMode == BLEND_MODE_REPLACE) {
      FillBackground(output, TransparentPixel<PixelType>());
    }
    RenderDrawableCommand<PixelType>(output, scene, command);
  }

  g_renderCommandState = previousState;
}

}  // namespace

std::vector<std::pair<double, double>> BuildOpenStrokeOutline(
  const std::vector<std::pair<double, double>>& vertices,
  double halfWidth,
  int strokeCap,
  int strokeJoin
) {
  return BuildOpenStrokeOutlineInternal(vertices, halfWidth, strokeCap, strokeJoin);
}

ClosedStrokeRing BuildClosedStrokeRing(
  const std::vector<std::pair<double, double>>& vertices,
  double halfWidth,
  int strokeJoin
) {
  return BuildClosedStrokeRingInternal(vertices, halfWidth, strokeJoin);
}

PF_Pixel16 ToPixel16(const PF_Pixel& color) {
  PF_Pixel16 result;
  result.alpha = static_cast<A_u_short>(color.alpha * 257);
  result.red = static_cast<A_u_short>(color.red * 257);
  result.green = static_cast<A_u_short>(color.green * 257);
  result.blue = static_cast<A_u_short>(color.blue * 257);
  return result;
}

Transform2D MakeIdentityTransform() {
  return Transform2D();
}

Transform2D MultiplyTransform(const Transform2D& left, const Transform2D& right) {
  Transform2D result;
  result.a = left.a * right.a + left.c * right.b;
  result.b = left.b * right.a + left.d * right.b;
  result.c = left.a * right.c + left.c * right.d;
  result.d = left.b * right.c + left.d * right.d;
  result.tx = left.a * right.tx + left.c * right.ty + left.tx;
  result.ty = left.b * right.tx + left.d * right.ty + left.ty;
  return result;
}

Transform2D MakeTranslation(double x, double y) {
  Transform2D result;
  result.tx = x;
  result.ty = y;
  return result;
}

Transform2D MakeRotation(double radians) {
  Transform2D result;
  const double cosine = std::cos(radians);
  const double sine = std::sin(radians);
  result.a = cosine;
  result.b = sine;
  result.c = -sine;
  result.d = cosine;
  return result;
}

Transform2D MakeScale(double x, double y) {
  Transform2D result;
  result.a = x;
  result.d = y;
  return result;
}

void ApplyTransform(const Transform2D& transform, double x, double y, double* outX, double* outY) {
  if (outX) {
    *outX = transform.a * x + transform.c * y + transform.tx;
  }
  if (outY) {
    *outY = transform.b * x + transform.d * y + transform.ty;
  }
}

bool InvertTransform(const Transform2D& transform, Transform2D* inverse) {
  if (!inverse) {
    return false;
  }

  const double determinant = transform.a * transform.d - transform.b * transform.c;
  if (std::fabs(determinant) < 1e-9) {
    return false;
  }

  const double invDeterminant = 1.0 / determinant;
  inverse->a = transform.d * invDeterminant;
  inverse->b = -transform.b * invDeterminant;
  inverse->c = -transform.c * invDeterminant;
  inverse->d = transform.a * invDeterminant;
  inverse->tx = -(inverse->a * transform.tx + inverse->c * transform.ty);
  inverse->ty = -(inverse->b * transform.tx + inverse->d * transform.ty);
  return true;
}

double ApproximateTransformScale(const Transform2D& transform) {
  const double scaleX = std::sqrt(transform.a * transform.a + transform.b * transform.b);
  const double scaleY = std::sqrt(transform.c * transform.c + transform.d * transform.d);
  const double average = (scaleX + scaleY) * 0.5;
  return average > 0.0 ? average : 1.0;
}

PF_LayerDef MakeSurface8(A_long width, A_long height, std::vector<PF_Pixel>* pixels) {
  PF_LayerDef surface;
  AEFX_CLR_STRUCT(surface);
  surface.width = width;
  surface.height = height;
  surface.rowbytes = width * static_cast<A_long>(sizeof(PF_Pixel));
  surface.data = reinterpret_cast<PF_PixelPtr>(pixels ? pixels->data() : NULL);
  return surface;
}

void CopySurface8To8(PF_LayerDef* output, const std::vector<PF_Pixel>& pixels) {
  if (!output) {
    return;
  }

  for (A_long y = 0; y < output->height; ++y) {
    auto* row = reinterpret_cast<PF_Pixel*>(
      reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
    );
    const PF_Pixel* sourceRow = &pixels[static_cast<std::size_t>(y * output->width)];
    for (A_long x = 0; x < output->width; ++x) {
      row[x] = sourceRow[x];
    }
  }
}

void CopySurface8To16(PF_LayerDef* output, const std::vector<PF_Pixel>& pixels) {
  if (!output) {
    return;
  }

  for (A_long y = 0; y < output->height; ++y) {
    auto* row = reinterpret_cast<PF_Pixel16*>(
      reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
    );
    const PF_Pixel* sourceRow = &pixels[static_cast<std::size_t>(y * output->width)];
    for (A_long x = 0; x < output->width; ++x) {
      row[x] = ToPixel16(sourceRow[x]);
    }
  }
}

void CopySurface8To32(PF_LayerDef* output, const std::vector<PF_Pixel>& pixels) {
  if (!output) {
    return;
  }

  for (A_long y = 0; y < output->height; ++y) {
    auto* row = reinterpret_cast<PF_PixelFloat*>(
      reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
    );
    const PF_Pixel* sourceRow = &pixels[static_cast<std::size_t>(y * output->width)];
    for (A_long x = 0; x < output->width; ++x) {
      row[x].alpha = static_cast<PF_FpShort>(static_cast<double>(sourceRow[x].alpha) / 255.0);
      row[x].red = static_cast<PF_FpShort>(static_cast<double>(sourceRow[x].red) / 255.0);
      row[x].green = static_cast<PF_FpShort>(static_cast<double>(sourceRow[x].green) / 255.0);
      row[x].blue = static_cast<PF_FpShort>(static_cast<double>(sourceRow[x].blue) / 255.0);
    }
  }
}

double ResolveScalarSpec(const ScalarSpec& spec, PF_LayerDef* output) {
  if (spec.mode == "fractionWidth") {
    return static_cast<double>(output->width) * spec.value;
  }

  if (spec.mode == "fractionHeight") {
    return static_cast<double>(output->height) * spec.value;
  }

  return spec.value;
}

double GetSceneWidth(const ScenePayload& scene, PF_LayerDef* output) {
  if (scene.canvasWidth > 0.0) {
    return scene.canvasWidth;
  }
  return output ? static_cast<double>(output->width) : 0.0;
}

double GetSceneHeight(const ScenePayload& scene, PF_LayerDef* output) {
  if (scene.canvasHeight > 0.0) {
    return scene.canvasHeight;
  }
  return output ? static_cast<double>(output->height) : 0.0;
}

void RenderScene8(PF_LayerDef* output, const ScenePayload& scene) {
  RenderSceneImpl<PF_Pixel>(output, scene);
}

void RenderScene16(PF_LayerDef* output, const ScenePayload& scene) {
  RenderSceneImpl<PF_Pixel16>(output, scene);
}

void ApplySceneToSurface8(PF_LayerDef* output, const ScenePayload& scene) {
  if (!output) {
    return;
  }

  if (scene.clearsSurface) {
    FillBackground(output, PF_Pixel{0, 0, 0, 0});
  }

  RenderScene8(output, scene);
}

bool SceneFullyClearsSurface(const ScenePayload& scene) {
  bool clearsSurface = scene.clearsSurface || (scene.hasBackground && scene.background.alpha >= 255);
  int clipDepth = 0;
  for (std::size_t index = 0; index < scene.commands.size(); ++index) {
    const SceneCommand& command = scene.commands[index];
    if (command.type == "clip_begin") {
      clipDepth += 1;
      continue;
    }
    if (command.type == "clip_end") {
      clipDepth = std::max(0, clipDepth - 1);
      continue;
    }
    if (command.type == "clear") {
      clearsSurface = true;
      continue;
    }
    if (command.type != "background") {
      continue;
    }
    const bool blendClears =
      command.blendMode == BLEND_MODE_BLEND || command.blendMode == BLEND_MODE_REPLACE;
    const bool noClip = clipDepth == 0 && !command.clipPath;
    const bool noErase = !command.eraseFill && !command.eraseStroke;
    if (blendClears &&
        noClip &&
        noErase &&
        command.fill.alpha >= 255 &&
        IsIdentityTransformValue(command.transform)) {
      clearsSurface = true;
    }
  }
  return clearsSurface;
}

void ApplySceneBackgroundToRaster8(
  std::vector<PF_Pixel>* raster,
  A_long width,
  A_long height,
  const ScenePayload& scene
) {
  if (!raster) {
    return;
  }

  raster->assign(static_cast<std::size_t>(width * height), PF_Pixel{0, 0, 0, 0});
  PF_LayerDef surface = MakeSurface8(width, height, raster);

  if (scene.clearsSurface) {
    FillBackground(&surface, PF_Pixel{0, 0, 0, 0});
  }

  if (scene.hasBackground) {
    if (scene.background.alpha >= 255) {
      FillBackground(&surface, scene.background);
    } else if (scene.background.alpha > 0) {
      BlendBackground(&surface, scene.background);
    }
  }
}

void ApplySceneToRaster8(
  std::vector<PF_Pixel>* raster,
  A_long width,
  A_long height,
  const ScenePayload& scene
) {
  if (!raster) {
    return;
  }

  PF_LayerDef surface = MakeSurface8(width, height, raster);
  ApplySceneToSurface8(&surface, scene);
}

void ApplySceneCommandRangeToRaster8(
  std::vector<PF_Pixel>* raster,
  A_long width,
  A_long height,
  const ScenePayload& scene,
  std::size_t startCommandIndex,
  std::size_t endCommandIndex
) {
  if (!raster) {
    return;
  }

  PF_LayerDef surface = MakeSurface8(width, height, raster);
  RenderSceneImpl<PF_Pixel>(&surface, scene, startCommandIndex, endCommandIndex);
}

void CompositeRasterBlockToRaster8(
  std::vector<PF_Pixel>* raster,
  A_long width,
  A_long height,
  const std::vector<PF_Pixel>& blockRaster,
  int x,
  int y,
  int blockWidth,
  int blockHeight
) {
  if (!raster || width <= 0 || height <= 0 || blockWidth <= 0 || blockHeight <= 0) {
    return;
  }
  if (blockRaster.size() < static_cast<std::size_t>(blockWidth * blockHeight)) {
    return;
  }

  PF_LayerDef surface = MakeSurface8(width, height, raster);
  for (int row = 0; row < blockHeight; ++row) {
    const int dstY = y + row;
    if (dstY < 0 || dstY >= height) {
      continue;
    }
    for (int col = 0; col < blockWidth; ++col) {
      const int dstX = x + col;
      if (dstX < 0 || dstX >= width) {
        continue;
      }

      const PF_Pixel& source = blockRaster[static_cast<std::size_t>(row * blockWidth + col)];
      if (source.alpha == 0) {
        continue;
      }
      BlendPixel(&surface, dstX, dstY, source, 1.0, false, 1.0);
    }
  }
}

void DrawDiagnostic(PF_LayerDef* output, const PF_Pixel& background, const PF_Pixel& accent) {
  DrawDiagnosticImpl(output, background, accent);
}

void DrawDiagnostic(PF_LayerDef* output, const PF_Pixel16& background, const PF_Pixel16& accent) {
  DrawDiagnosticImpl(output, background, accent);
}

}  // namespace momentum
