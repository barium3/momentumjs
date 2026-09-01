// Intentionally valid in both CUDA C++ and OpenCL C after the backend
// preamble defines MOMENTUM_KERNEL, MOMENTUM_GLOBAL, MOMENTUM_X/Y and the
// small math macros below. This is the single source of truth for Windows GPU
// pixel semantics.

typedef unsigned int MomentumUInt;
typedef int MomentumInt;

typedef struct MomentumFloat2 {
  float x;
  float y;
} MomentumFloat2;

typedef struct MomentumFloat4 {
  float x;
  float y;
  float z;
  float w;
} MomentumFloat4;

typedef struct MomentumTriangle {
  MomentumFloat2 a;
  MomentumFloat2 b;
  MomentumFloat2 c;
} MomentumTriangle;

typedef struct MomentumEdge {
  MomentumFloat2 a;
  MomentumFloat2 b;
} MomentumEdge;

typedef struct MomentumContour {
  MomentumUInt vertexStart;
  MomentumUInt vertexCount;
} MomentumContour;

typedef struct MomentumFillParams {
  MomentumUInt regionOriginX;
  MomentumUInt regionOriginY;
  MomentumUInt regionWidth;
  MomentumUInt regionHeight;
  MomentumUInt canvasWidth;
  MomentumUInt canvasHeight;
  MomentumUInt triangleCount;
  MomentumUInt edgeCount;
  MomentumUInt clipContourStart;
  MomentumUInt clipContourCount;
  MomentumUInt clipWidth;
  MomentumUInt clipHeight;
  float colorR;
  float colorG;
  float colorB;
  float colorA;
  float boundsMinX;
  float boundsMinY;
  float boundsMaxX;
  float boundsMaxY;
  float clipMinX;
  float clipMinY;
  float clipMaxX;
  float clipMaxY;
} MomentumFillParams;

typedef struct MomentumPathFillParams {
  MomentumUInt regionOriginX;
  MomentumUInt regionOriginY;
  MomentumUInt regionWidth;
  MomentumUInt regionHeight;
  MomentumUInt canvasWidth;
  MomentumUInt canvasHeight;
  MomentumUInt contourStart;
  MomentumUInt contourCount;
  MomentumUInt clipContourStart;
  MomentumUInt clipContourCount;
  MomentumUInt clipWidth;
  MomentumUInt clipHeight;
  float colorR;
  float colorG;
  float colorB;
  float colorA;
  float boundsMinX;
  float boundsMinY;
  float boundsMaxX;
  float boundsMaxY;
  float clipMinX;
  float clipMinY;
  float clipMaxX;
  float clipMaxY;
} MomentumPathFillParams;

typedef struct MomentumImageParams {
  MomentumUInt regionOriginX;
  MomentumUInt regionOriginY;
  MomentumUInt regionWidth;
  MomentumUInt regionHeight;
  MomentumUInt canvasWidth;
  MomentumUInt canvasHeight;
  MomentumUInt imageWidth;
  MomentumUInt imageHeight;
  MomentumUInt clipWidth;
  MomentumUInt clipHeight;
  MomentumUInt textImage;
  MomentumUInt reserved;
  float x1; float y1; float u1; float v1;
  float x2; float y2; float u2; float v2;
  float x3; float y3; float u3; float v3;
  float x4; float y4; float u4; float v4;
  float tintR; float tintG; float tintB; float tintA;
} MomentumImageParams;

typedef struct MomentumBlendParams {
  MomentumUInt width;
  MomentumUInt height;
  MomentumInt blendMode;
  MomentumUInt erase;
  float eraseStrength;
} MomentumBlendParams;

typedef struct MomentumFilterParams {
  MomentumUInt width;
  MomentumUInt height;
  MomentumInt filterKind;
  float value;
} MomentumFilterParams;

typedef struct MomentumCopyOutputParams {
  MomentumUInt width;
  MomentumUInt height;
  MomentumUInt rowPixels;
  MomentumUInt sourceWidth;
  MomentumUInt sourceHeight;
  MomentumUInt logicalWidth;
  MomentumUInt logicalHeight;
  float sourceOriginX;
  float sourceOriginY;
  float sourceStepX;
  float sourceStepY;
} MomentumCopyOutputParams;

typedef struct MomentumEdgeInfo {
  float distance;
  MomentumFloat2 a;
  MomentumFloat2 b;
} MomentumEdgeInfo;

MOMENTUM_INLINE float momentum_min(float a, float b) { return a < b ? a : b; }
MOMENTUM_INLINE float momentum_max(float a, float b) { return a > b ? a : b; }
MOMENTUM_INLINE float momentum_clamp(float value, float low, float high) {
  return momentum_min(momentum_max(value, low), high);
}
MOMENTUM_INLINE MomentumInt momentum_clamp_int(
  MomentumInt value,
  MomentumInt low,
  MomentumInt high
) {
  return value < low ? low : (value > high ? high : value);
}
MOMENTUM_INLINE MomentumFloat2 momentum_float2(float x, float y) {
  MomentumFloat2 result = {x, y};
  return result;
}
MOMENTUM_INLINE MomentumFloat4 momentum_float4(float x, float y, float z, float w) {
  MomentumFloat4 result = {x, y, z, w};
  return result;
}
MOMENTUM_INLINE MomentumFloat4 momentum_add4(MomentumFloat4 a, MomentumFloat4 b) {
  return momentum_float4(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
}
MOMENTUM_INLINE MomentumFloat4 momentum_mul4(MomentumFloat4 value, float scale) {
  return momentum_float4(value.x * scale, value.y * scale, value.z * scale, value.w * scale);
}
MOMENTUM_INLINE MomentumFloat4 momentum_mix4(
  MomentumFloat4 a,
  MomentumFloat4 b,
  float t
) {
  return momentum_float4(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
    a.w + (b.w - a.w) * t
  );
}
MOMENTUM_INLINE float momentum_dot2(MomentumFloat2 a, MomentumFloat2 b) {
  return a.x * b.x + a.y * b.y;
}
MOMENTUM_INLINE float momentum_distance_segment(
  MomentumFloat2 point,
  MomentumFloat2 start,
  MomentumFloat2 end
) {
  MomentumFloat2 delta = momentum_float2(end.x - start.x, end.y - start.y);
  MomentumFloat2 relative = momentum_float2(point.x - start.x, point.y - start.y);
  float lengthSquared = momentum_max(momentum_dot2(delta, delta), 1.0e-6f);
  float t = momentum_clamp(momentum_dot2(relative, delta) / lengthSquared, 0.0f, 1.0f);
  float dx = point.x - (start.x + delta.x * t);
  float dy = point.y - (start.y + delta.y * t);
  return MOMENTUM_SQRT(dx * dx + dy * dy);
}
MOMENTUM_INLINE MomentumInt momentum_point_in_triangle(
  MomentumFloat2 point,
  MomentumFloat2 a,
  MomentumFloat2 b,
  MomentumFloat2 c
) {
  float c0 = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  float c1 = (c.x - b.x) * (point.y - b.y) - (c.y - b.y) * (point.x - b.x);
  float c2 = (a.x - c.x) * (point.y - c.y) - (a.y - c.y) * (point.x - c.x);
  MomentumInt hasNeg = c0 < 0.0f || c1 < 0.0f || c2 < 0.0f;
  MomentumInt hasPos = c0 > 0.0f || c1 > 0.0f || c2 > 0.0f;
  return !(hasNeg && hasPos);
}
MOMENTUM_INLINE MomentumInt momentum_in_any_triangle(
  MomentumFloat2 point,
  MOMENTUM_GLOBAL const MomentumTriangle* triangles,
  MomentumUInt count
) {
  for (MomentumUInt index = 0; index < count; ++index) {
    MomentumTriangle triangle = triangles[index];
    if (momentum_point_in_triangle(point, triangle.a, triangle.b, triangle.c)) {
      return 1;
    }
  }
  return 0;
}
MOMENTUM_INLINE MomentumEdgeInfo momentum_nearest_fill_edge(
  MomentumFloat2 point,
  MOMENTUM_GLOBAL const MomentumEdge* edges,
  MomentumUInt count
) {
  MomentumEdgeInfo result;
  result.distance = 3.402823466e+38f;
  result.a = momentum_float2(0.0f, 0.0f);
  result.b = momentum_float2(0.0f, 0.0f);
  for (MomentumUInt index = 0; index < count; ++index) {
    MomentumEdge edge = edges[index];
    float distance = momentum_distance_segment(point, edge.a, edge.b);
    if (distance < result.distance) {
      result.distance = distance;
      result.a = edge.a;
      result.b = edge.b;
    }
  }
  return result;
}
MOMENTUM_INLINE MomentumInt momentum_winding(
  MomentumFloat2 point,
  MOMENTUM_GLOBAL const MomentumFloat2* vertices,
  MOMENTUM_GLOBAL const MomentumContour* contours,
  MomentumUInt contourStart,
  MomentumUInt contourCount
) {
  MomentumInt winding = 0;
  for (MomentumUInt contourIndex = 0; contourIndex < contourCount; ++contourIndex) {
    MomentumContour contour = contours[contourStart + contourIndex];
    if (contour.vertexCount < 2U) {
      continue;
    }
    for (MomentumUInt vertexIndex = 0; vertexIndex < contour.vertexCount; ++vertexIndex) {
      MomentumFloat2 a = vertices[contour.vertexStart + vertexIndex];
      MomentumFloat2 b = vertices[
        contour.vertexStart + ((vertexIndex + 1U) % contour.vertexCount)
      ];
      MomentumInt upward = a.y <= point.y && b.y > point.y;
      MomentumInt downward = a.y > point.y && b.y <= point.y;
      if (!upward && !downward) {
        continue;
      }
      float cross =
        (b.x - a.x) * (point.y - a.y) -
        (point.x - a.x) * (b.y - a.y);
      if (upward && cross > 0.0f) {
        winding += 1;
      } else if (downward && cross < 0.0f) {
        winding -= 1;
      }
    }
  }
  return winding;
}
MOMENTUM_INLINE MomentumEdgeInfo momentum_nearest_path_edge(
  MomentumFloat2 point,
  MOMENTUM_GLOBAL const MomentumFloat2* vertices,
  MOMENTUM_GLOBAL const MomentumContour* contours,
  MomentumUInt contourStart,
  MomentumUInt contourCount
) {
  MomentumEdgeInfo result;
  result.distance = 3.402823466e+38f;
  result.a = momentum_float2(0.0f, 0.0f);
  result.b = momentum_float2(0.0f, 0.0f);
  for (MomentumUInt contourIndex = 0; contourIndex < contourCount; ++contourIndex) {
    MomentumContour contour = contours[contourStart + contourIndex];
    if (contour.vertexCount < 2U) {
      continue;
    }
    for (MomentumUInt vertexIndex = 0; vertexIndex < contour.vertexCount; ++vertexIndex) {
      MomentumFloat2 a = vertices[contour.vertexStart + vertexIndex];
      MomentumFloat2 b = vertices[
        contour.vertexStart + ((vertexIndex + 1U) % contour.vertexCount)
      ];
      float distance = momentum_distance_segment(point, a, b);
      if (distance < result.distance) {
        result.distance = distance;
        result.a = a;
        result.b = b;
      }
    }
  }
  return result;
}
MOMENTUM_INLINE float momentum_edge_coverage(
  float signedDistance,
  MomentumFloat2 a,
  MomentumFloat2 b
) {
  float dx = MOMENTUM_ABS(b.x - a.x);
  float dy = MOMENTUM_ABS(b.y - a.y);
  if (dx <= 1.0e-3f || dy <= 1.0e-3f) {
    MomentumInt aligned = dx <= 1.0e-3f
      ? MOMENTUM_ABS(a.x - MOMENTUM_ROUND(a.x)) <= 0.125f
      : MOMENTUM_ABS(a.y - MOMENTUM_ROUND(a.y)) <= 0.125f;
    if (aligned) {
      return signedDistance < 0.0f ? 1.0f : 0.0f;
    }
  }
  return momentum_clamp(0.5f - signedDistance, 0.0f, 1.0f);
}
MOMENTUM_INLINE MomentumFloat4 momentum_read_clamped(
  MOMENTUM_GLOBAL const MomentumFloat4* pixels,
  MomentumInt x,
  MomentumInt y,
  MomentumUInt width,
  MomentumUInt height
) {
  MomentumInt maxX = width > 0U ? (MomentumInt)width - 1 : 0;
  MomentumInt maxY = height > 0U ? (MomentumInt)height - 1 : 0;
  MomentumUInt px = (MomentumUInt)momentum_clamp_int(x, 0, maxX);
  MomentumUInt py = (MomentumUInt)momentum_clamp_int(y, 0, maxY);
  return pixels[py * width + px];
}
MOMENTUM_INLINE MomentumFloat4 momentum_sample_linear(
  MOMENTUM_GLOBAL const MomentumFloat4* pixels,
  float u,
  float v,
  MomentumUInt width,
  MomentumUInt height
) {
  float clampedU = momentum_clamp(u, 0.0f, 1.0f);
  float clampedV = momentum_clamp(v, 0.0f, 1.0f);
  float sourceX = clampedU * (float)(width > 0U ? width : 1U) - 0.5f;
  float sourceY = clampedV * (float)(height > 0U ? height : 1U) - 0.5f;
  float baseX = MOMENTUM_FLOOR(sourceX);
  float baseY = MOMENTUM_FLOOR(sourceY);
  float fractionX = sourceX - baseX;
  float fractionY = sourceY - baseY;
  MomentumInt x0 = (MomentumInt)baseX;
  MomentumInt y0 = (MomentumInt)baseY;
  MomentumFloat4 c00 = momentum_read_clamped(pixels, x0, y0, width, height);
  MomentumFloat4 c10 = momentum_read_clamped(pixels, x0 + 1, y0, width, height);
  MomentumFloat4 c01 = momentum_read_clamped(pixels, x0, y0 + 1, width, height);
  MomentumFloat4 c11 = momentum_read_clamped(pixels, x0 + 1, y0 + 1, width, height);
  return momentum_mix4(
    momentum_mix4(c00, c10, fractionX),
    momentum_mix4(c01, c11, fractionX),
    fractionY
  );
}
MOMENTUM_INLINE float momentum_clip_alpha(
  MOMENTUM_GLOBAL const MomentumFloat4* clip,
  MomentumFloat2 point,
  MomentumUInt canvasWidth,
  MomentumUInt canvasHeight,
  MomentumUInt clipWidth,
  MomentumUInt clipHeight
) {
  float u = canvasWidth > 0U ? point.x / (float)canvasWidth : 0.0f;
  float v = canvasHeight > 0U ? point.y / (float)canvasHeight : 0.0f;
  return momentum_clamp(
    momentum_sample_linear(clip, u, v, clipWidth, clipHeight).w,
    0.0f,
    1.0f
  );
}
MOMENTUM_INLINE float momentum_analytic_clip(
  MomentumFloat2 point,
  MOMENTUM_GLOBAL const MomentumFloat2* vertices,
  MOMENTUM_GLOBAL const MomentumContour* contours,
  MomentumUInt contourStart,
  MomentumUInt contourCount,
  float minX,
  float minY,
  float maxX,
  float maxY
) {
  if (contourCount == 0U) {
    return 1.0f;
  }
  if (point.x < minX - 1.0f || point.y < minY - 1.0f ||
      point.x > maxX + 1.0f || point.y > maxY + 1.0f) {
    return 0.0f;
  }
  MomentumInt inside = momentum_winding(
    point, vertices, contours, contourStart, contourCount
  ) != 0;
  MomentumEdgeInfo edge = momentum_nearest_path_edge(
    point, vertices, contours, contourStart, contourCount
  );
  return momentum_edge_coverage(inside ? -edge.distance : edge.distance, edge.a, edge.b);
}
MOMENTUM_INLINE void momentum_source_over(
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MomentumUInt index,
  MomentumFloat4 source
) {
  MomentumFloat4 target = destination[index];
  float inverse = 1.0f - source.w;
  destination[index] = momentum_float4(
    source.x + target.x * inverse,
    source.y + target.y * inverse,
    source.z + target.z * inverse,
    source.w + target.w * inverse
  );
}

MOMENTUM_KERNEL(momentum_clear)(
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MomentumUInt width,
  MomentumUInt height,
  MomentumFloat4 color
) {
  MomentumUInt x = MOMENTUM_X;
  MomentumUInt y = MOMENTUM_Y;
  if (x < width && y < height) {
    destination[y * width + x] = color;
  }
}

MOMENTUM_KERNEL(momentum_copy)(
  MOMENTUM_GLOBAL const MomentumFloat4* source,
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MomentumUInt width,
  MomentumUInt height
) {
  MomentumUInt x = MOMENTUM_X;
  MomentumUInt y = MOMENTUM_Y;
  if (x < width && y < height) {
    MomentumUInt index = y * width + x;
    destination[index] = source[index];
  }
}

MOMENTUM_KERNEL(momentum_fill)(
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MOMENTUM_GLOBAL const MomentumTriangle* triangles,
  MOMENTUM_GLOBAL const MomentumEdge* edges,
  MOMENTUM_GLOBAL const MomentumFloat2* clipVertices,
  MOMENTUM_GLOBAL const MomentumContour* clipContours,
  MOMENTUM_GLOBAL const MomentumFloat4* clipImage,
  MomentumFillParams params
) {
  MomentumUInt gx = MOMENTUM_X;
  MomentumUInt gy = MOMENTUM_Y;
  if (gx >= params.regionWidth || gy >= params.regionHeight) {
    return;
  }
  MomentumUInt x = params.regionOriginX + gx;
  MomentumUInt y = params.regionOriginY + gy;
  if (x >= params.canvasWidth || y >= params.canvasHeight) {
    return;
  }
  MomentumFloat2 point = momentum_float2((float)x + 0.5f, (float)y + 0.5f);
  if (point.x < params.boundsMinX - 1.0f || point.y < params.boundsMinY - 1.0f ||
      point.x > params.boundsMaxX + 1.0f || point.y > params.boundsMaxY + 1.0f) {
    return;
  }
  MomentumInt inside = momentum_in_any_triangle(point, triangles, params.triangleCount);
  if (!inside && params.edgeCount == 0U) {
    return;
  }
  MomentumEdgeInfo edge;
  if (params.edgeCount > 0U) {
    edge = momentum_nearest_fill_edge(point, edges, params.edgeCount);
  } else {
    edge.distance = inside ? 0.0f : 3.402823466e+38f;
    edge.a = momentum_float2(0.0f, 0.0f);
    edge.b = momentum_float2(0.0f, 0.0f);
  }
  float coverage = momentum_edge_coverage(
    inside ? -edge.distance : edge.distance, edge.a, edge.b
  );
  if (coverage <= 1.0e-6f) {
    return;
  }
  float clipAlpha = params.clipContourCount > 0U
    ? momentum_analytic_clip(
        point,
        clipVertices,
        clipContours,
        params.clipContourStart,
        params.clipContourCount,
        params.clipMinX,
        params.clipMinY,
        params.clipMaxX,
        params.clipMaxY)
    : momentum_clip_alpha(
        clipImage,
        point,
        params.canvasWidth,
        params.canvasHeight,
        params.clipWidth,
        params.clipHeight);
  float alpha = momentum_clamp(params.colorA * coverage * clipAlpha, 0.0f, 1.0f);
  if (alpha <= 1.0e-6f) {
    return;
  }
  momentum_source_over(
    destination,
    y * params.canvasWidth + x,
    momentum_float4(params.colorR * alpha, params.colorG * alpha, params.colorB * alpha, alpha)
  );
}

MOMENTUM_KERNEL(momentum_path_fill)(
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MOMENTUM_GLOBAL const MomentumFloat2* vertices,
  MOMENTUM_GLOBAL const MomentumContour* contours,
  MOMENTUM_GLOBAL const MomentumFloat4* clipImage,
  MomentumPathFillParams params
) {
  MomentumUInt gx = MOMENTUM_X;
  MomentumUInt gy = MOMENTUM_Y;
  if (gx >= params.regionWidth || gy >= params.regionHeight) {
    return;
  }
  MomentumUInt x = params.regionOriginX + gx;
  MomentumUInt y = params.regionOriginY + gy;
  if (x >= params.canvasWidth || y >= params.canvasHeight) {
    return;
  }
  MomentumFloat2 point = momentum_float2((float)x + 0.5f, (float)y + 0.5f);
  if (point.x < params.boundsMinX - 1.0f || point.y < params.boundsMinY - 1.0f ||
      point.x > params.boundsMaxX + 1.0f || point.y > params.boundsMaxY + 1.0f) {
    return;
  }
  MomentumInt inside = momentum_winding(
    point, vertices, contours, params.contourStart, params.contourCount
  ) != 0;
  MomentumEdgeInfo edge = momentum_nearest_path_edge(
    point, vertices, contours, params.contourStart, params.contourCount
  );
  float coverage = momentum_edge_coverage(
    inside ? -edge.distance : edge.distance, edge.a, edge.b
  );
  if (coverage <= 1.0e-6f) {
    return;
  }
  float clipAlpha = params.clipContourCount > 0U
    ? momentum_analytic_clip(
        point,
        vertices,
        contours,
        params.clipContourStart,
        params.clipContourCount,
        params.clipMinX,
        params.clipMinY,
        params.clipMaxX,
        params.clipMaxY)
    : momentum_clip_alpha(
        clipImage,
        point,
        params.canvasWidth,
        params.canvasHeight,
        params.clipWidth,
        params.clipHeight);
  float alpha = momentum_clamp(params.colorA * coverage * clipAlpha, 0.0f, 1.0f);
  if (alpha <= 1.0e-6f) {
    return;
  }
  momentum_source_over(
    destination,
    y * params.canvasWidth + x,
    momentum_float4(params.colorR * alpha, params.colorG * alpha, params.colorB * alpha, alpha)
  );
}

MOMENTUM_INLINE MomentumInt momentum_barycentric(
  MomentumFloat2 point,
  MomentumFloat2 a,
  MomentumFloat2 b,
  MomentumFloat2 c,
  float* wa,
  float* wb,
  float* wc
) {
  float denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (MOMENTUM_ABS(denominator) <= 1.0e-8f) {
    return 0;
  }
  *wa = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
  *wb = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
  *wc = 1.0f - *wa - *wb;
  return *wa >= -1.0e-5f && *wb >= -1.0e-5f && *wc >= -1.0e-5f;
}

MOMENTUM_KERNEL(momentum_image)(
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MOMENTUM_GLOBAL const MomentumFloat4* image,
  MOMENTUM_GLOBAL const MomentumFloat4* clipImage,
  MomentumImageParams params
) {
  MomentumUInt gx = MOMENTUM_X;
  MomentumUInt gy = MOMENTUM_Y;
  if (gx >= params.regionWidth || gy >= params.regionHeight) {
    return;
  }
  MomentumUInt x = params.regionOriginX + gx;
  MomentumUInt y = params.regionOriginY + gy;
  if (x >= params.canvasWidth || y >= params.canvasHeight) {
    return;
  }
  MomentumFloat2 point = momentum_float2((float)x + 0.5f, (float)y + 0.5f);
  MomentumFloat2 p1 = momentum_float2(params.x1, params.y1);
  MomentumFloat2 p2 = momentum_float2(params.x2, params.y2);
  MomentumFloat2 p3 = momentum_float2(params.x3, params.y3);
  MomentumFloat2 p4 = momentum_float2(params.x4, params.y4);
  float wa = 0.0f;
  float wb = 0.0f;
  float wc = 0.0f;
  float u = 0.0f;
  float v = 0.0f;
  if (momentum_barycentric(point, p1, p2, p3, &wa, &wb, &wc)) {
    u = wa * params.u1 + wb * params.u2 + wc * params.u3;
    v = wa * params.v1 + wb * params.v2 + wc * params.v3;
  } else if (momentum_barycentric(point, p1, p3, p4, &wa, &wb, &wc)) {
    u = wa * params.u1 + wb * params.u3 + wc * params.u4;
    v = wa * params.v1 + wb * params.v3 + wc * params.v4;
  } else {
    return;
  }
  MomentumFloat4 sampled = momentum_sample_linear(
    image, u, v, params.imageWidth, params.imageHeight
  );
  float sampledAlpha = momentum_clamp(sampled.w, 0.0f, 1.0f);
  float straightR = sampledAlpha > 1.0e-6f ? sampled.x / sampledAlpha : 0.0f;
  float straightG = sampledAlpha > 1.0e-6f ? sampled.y / sampledAlpha : 0.0f;
  float straightB = sampledAlpha > 1.0e-6f ? sampled.z / sampledAlpha : 0.0f;
  float clipAlpha = momentum_clip_alpha(
    clipImage,
    point,
    params.canvasWidth,
    params.canvasHeight,
    params.clipWidth,
    params.clipHeight
  );
  float alpha = sampledAlpha * params.tintA * clipAlpha;
  if (alpha <= 1.0e-6f) {
    return;
  }
  momentum_source_over(
    destination,
    y * params.canvasWidth + x,
    momentum_float4(
      straightR * params.tintR * alpha,
      straightG * params.tintG * alpha,
      straightB * params.tintB * alpha,
      alpha)
  );
}

MOMENTUM_INLINE float momentum_softlight_d(float backdrop) {
  return backdrop <= 0.25f
    ? ((16.0f * backdrop - 12.0f) * backdrop + 4.0f) * backdrop
    : MOMENTUM_SQRT(backdrop);
}
MOMENTUM_INLINE float momentum_blend_channel(
  float backdrop,
  float source,
  MomentumInt mode
) {
  switch (mode) {
    case 402: return momentum_min(backdrop, source);
    case 403: return momentum_max(backdrop, source);
    case 404: return MOMENTUM_ABS(backdrop - source);
    case 405: return backdrop + source - 2.0f * backdrop * source;
    case 406: return backdrop * source;
    case 407: return backdrop + source - backdrop * source;
    case 410: return backdrop <= 0.5f
      ? 2.0f * backdrop * source
      : 1.0f - 2.0f * (1.0f - backdrop) * (1.0f - source);
    case 411: return source <= 0.5f
      ? 2.0f * backdrop * source
      : 1.0f - 2.0f * (1.0f - backdrop) * (1.0f - source);
    case 412: return source <= 0.5f
      ? backdrop - (1.0f - 2.0f * source) * backdrop * (1.0f - backdrop)
      : backdrop + (2.0f * source - 1.0f) * (momentum_softlight_d(backdrop) - backdrop);
    case 413: return source >= 1.0f
      ? 1.0f
      : momentum_min(1.0f, backdrop / momentum_max(1.0f - source, 1.0e-5f));
    case 414: return source <= 0.0f
      ? 0.0f
      : 1.0f - momentum_min(1.0f, (1.0f - backdrop) / momentum_max(source, 1.0e-5f));
    default: return source;
  }
}

MOMENTUM_KERNEL(momentum_composite)(
  MOMENTUM_GLOBAL const MomentumFloat4* source,
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MomentumBlendParams params
) {
  MomentumUInt x = MOMENTUM_X;
  MomentumUInt y = MOMENTUM_Y;
  if (x >= params.width || y >= params.height) {
    return;
  }
  MomentumUInt index = y * params.width + x;
  MomentumFloat4 srcPremul = source[index];
  MomentumFloat4 dstPremul = destination[index];
  float srcA = momentum_clamp(srcPremul.w, 0.0f, 1.0f);
  float dstA = momentum_clamp(dstPremul.w, 0.0f, 1.0f);
  float srcR = srcA > 1.0e-6f ? srcPremul.x / srcA : 0.0f;
  float srcG = srcA > 1.0e-6f ? srcPremul.y / srcA : 0.0f;
  float srcB = srcA > 1.0e-6f ? srcPremul.z / srcA : 0.0f;
  float dstR = dstA > 1.0e-6f ? dstPremul.x / dstA : 0.0f;
  float dstG = dstA > 1.0e-6f ? dstPremul.y / dstA : 0.0f;
  float dstB = dstA > 1.0e-6f ? dstPremul.z / dstA : 0.0f;
  if (params.erase != 0U || params.blendMode == 409) {
    float removal = momentum_clamp(
      srcA * (params.erase != 0U ? params.eraseStrength : 1.0f), 0.0f, 1.0f
    );
    float keep = 1.0f - removal;
    destination[index] = momentum_float4(
      dstPremul.x * keep, dstPremul.y * keep, dstPremul.z * keep, dstA * keep
    );
    return;
  }
  if (params.blendMode == 401) {
    destination[index] = momentum_float4(
      momentum_clamp(dstPremul.x + srcPremul.x, 0.0f, 1.0f),
      momentum_clamp(dstPremul.y + srcPremul.y, 0.0f, 1.0f),
      momentum_clamp(dstPremul.z + srcPremul.z, 0.0f, 1.0f),
      momentum_clamp(dstPremul.w + srcPremul.w, 0.0f, 1.0f)
    );
    return;
  }
  if (params.blendMode == 408) {
    destination[index] = srcPremul;
    return;
  }
  float blendR = momentum_blend_channel(dstR, srcR, params.blendMode);
  float blendG = momentum_blend_channel(dstG, srcG, params.blendMode);
  float blendB = momentum_blend_channel(dstB, srcB, params.blendMode);
  float outA = momentum_clamp(srcA + dstA - srcA * dstA, 0.0f, 1.0f);
  destination[index] = momentum_float4(
    momentum_clamp((1.0f - dstA) * srcA * srcR + (1.0f - srcA) * dstA * dstR + srcA * dstA * blendR, 0.0f, 1.0f),
    momentum_clamp((1.0f - dstA) * srcA * srcG + (1.0f - srcA) * dstA * dstG + srcA * dstA * blendG, 0.0f, 1.0f),
    momentum_clamp((1.0f - dstA) * srcA * srcB + (1.0f - srcA) * dstA * dstB + srcA * dstA * blendB, 0.0f, 1.0f),
    outA
  );
}

MOMENTUM_INLINE float momentum_luma(float red, float green, float blue) {
  return red * 0.299f + green * 0.587f + blue * 0.114f;
}

MOMENTUM_KERNEL(momentum_filter)(
  MOMENTUM_GLOBAL const MomentumFloat4* source,
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MomentumFilterParams params
) {
  MomentumUInt x = MOMENTUM_X;
  MomentumUInt y = MOMENTUM_Y;
  if (x >= params.width || y >= params.height) {
    return;
  }
  MomentumFloat4 src = source[y * params.width + x];
  float alpha = momentum_clamp(src.w, 0.0f, 1.0f);
  float red = alpha > 1.0e-6f ? src.x / alpha : 0.0f;
  float green = alpha > 1.0e-6f ? src.y / alpha : 0.0f;
  float blue = alpha > 1.0e-6f ? src.z / alpha : 0.0f;
  if (params.filterKind == 1) {
    red = green = blue = momentum_luma(red, green, blue);
  } else if (params.filterKind == 2) {
    red = 1.0f - red;
    green = 1.0f - green;
    blue = 1.0f - blue;
  } else if (params.filterKind == 3) {
    alpha = 1.0f;
  } else if (params.filterKind == 4) {
    float threshold = params.value > 0.0f
      ? momentum_clamp(params.value, 0.0f, 1.0f)
      : 0.5f;
    float value = momentum_luma(red, green, blue) >= threshold ? 1.0f : 0.0f;
    red = green = blue = value;
  } else if (params.filterKind == 5) {
    float levels = momentum_max(2.0f, MOMENTUM_ROUND(params.value));
    float step = 1.0f / momentum_max(levels - 1.0f, 1.0f);
    red = momentum_clamp(MOMENTUM_ROUND(red / step) * step, 0.0f, 1.0f);
    green = momentum_clamp(MOMENTUM_ROUND(green / step) * step, 0.0f, 1.0f);
    blue = momentum_clamp(MOMENTUM_ROUND(blue / step) * step, 0.0f, 1.0f);
  } else if (params.filterKind == 6) {
    MomentumInt radius = (MomentumInt)MOMENTUM_ROUND(params.value > 0.0f ? params.value : 1.0f);
    radius = momentum_clamp_int(radius, 1, 16);
    float sumR = 0.0f;
    float sumG = 0.0f;
    float sumB = 0.0f;
    float sumA = 0.0f;
    MomentumInt count = 0;
    for (MomentumInt oy = -16; oy <= 16; ++oy) {
      if (MOMENTUM_ABS_INT(oy) > radius) continue;
      for (MomentumInt ox = -16; ox <= 16; ++ox) {
        if (MOMENTUM_ABS_INT(ox) > radius) continue;
        MomentumFloat4 sample = momentum_read_clamped(
          source, (MomentumInt)x + ox, (MomentumInt)y + oy, params.width, params.height
        );
        float sampleA = momentum_clamp(sample.w, 0.0f, 1.0f);
        sumR += sampleA > 1.0e-6f ? sample.x / sampleA : 0.0f;
        sumG += sampleA > 1.0e-6f ? sample.y / sampleA : 0.0f;
        sumB += sampleA > 1.0e-6f ? sample.z / sampleA : 0.0f;
        sumA += sampleA;
        count += 1;
      }
    }
    if (count > 0) {
      red = sumR / (float)count;
      green = sumG / (float)count;
      blue = sumB / (float)count;
      alpha = sumA / (float)count;
    }
  } else if (params.filterKind == 7 || params.filterKind == 8) {
    MomentumInt erode = params.filterKind == 7;
    MomentumFloat4 chosen = src;
    float chosenLuma = momentum_luma(red, green, blue);
    for (MomentumInt oy = -1; oy <= 1; ++oy) {
      for (MomentumInt ox = -1; ox <= 1; ++ox) {
        MomentumFloat4 sample = momentum_read_clamped(
          source, (MomentumInt)x + ox, (MomentumInt)y + oy, params.width, params.height
        );
        float sampleA = momentum_clamp(sample.w, 0.0f, 1.0f);
        float sampleR = sampleA > 1.0e-6f ? sample.x / sampleA : 0.0f;
        float sampleG = sampleA > 1.0e-6f ? sample.y / sampleA : 0.0f;
        float sampleB = sampleA > 1.0e-6f ? sample.z / sampleA : 0.0f;
        float sampleLuma = momentum_luma(sampleR, sampleG, sampleB);
        if ((erode && sampleLuma < chosenLuma) || (!erode && sampleLuma > chosenLuma)) {
          chosen = sample;
          chosenLuma = sampleLuma;
        }
      }
    }
    alpha = momentum_clamp(chosen.w, 0.0f, 1.0f);
    red = alpha > 1.0e-6f ? chosen.x / alpha : 0.0f;
    green = alpha > 1.0e-6f ? chosen.y / alpha : 0.0f;
    blue = alpha > 1.0e-6f ? chosen.z / alpha : 0.0f;
  }
  alpha = momentum_clamp(alpha, 0.0f, 1.0f);
  red = momentum_clamp(red, 0.0f, 1.0f);
  green = momentum_clamp(green, 0.0f, 1.0f);
  blue = momentum_clamp(blue, 0.0f, 1.0f);
  destination[y * params.width + x] = momentum_float4(
    red * alpha, green * alpha, blue * alpha, alpha
  );
}

MOMENTUM_KERNEL(momentum_mask)(
  MOMENTUM_GLOBAL const MomentumFloat4* source,
  MOMENTUM_GLOBAL const MomentumFloat4* mask,
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MomentumUInt width,
  MomentumUInt height,
  MomentumUInt maskWidth,
  MomentumUInt maskHeight
) {
  MomentumUInt x = MOMENTUM_X;
  MomentumUInt y = MOMENTUM_Y;
  if (x >= width || y >= height) {
    return;
  }
  MomentumUInt maskX = width == maskWidth
    ? x
    : (MomentumUInt)momentum_clamp((float)x / (float)(width > 0U ? width : 1U) * (float)maskWidth, 0.0f, (float)(maskWidth > 0U ? maskWidth - 1U : 0U));
  MomentumUInt maskY = height == maskHeight
    ? y
    : (MomentumUInt)momentum_clamp((float)y / (float)(height > 0U ? height : 1U) * (float)maskHeight, 0.0f, (float)(maskHeight > 0U ? maskHeight - 1U : 0U));
  MomentumFloat4 src = source[y * width + x];
  float alpha = momentum_clamp(mask[maskY * maskWidth + maskX].w, 0.0f, 1.0f);
  destination[y * width + x] = momentum_float4(
    src.x * alpha, src.y * alpha, src.z * alpha, src.w * alpha
  );
}

MOMENTUM_KERNEL(momentum_copy_output)(
  MOMENTUM_GLOBAL const MomentumFloat4* source,
  MOMENTUM_GLOBAL MomentumFloat4* destination,
  MomentumCopyOutputParams params
) {
  MomentumUInt x = MOMENTUM_X;
  MomentumUInt y = MOMENTUM_Y;
  if (x >= params.width || y >= params.height) {
    return;
  }
  float logicalX = params.sourceOriginX + ((float)x + 0.5f) * params.sourceStepX;
  float logicalY = params.sourceOriginY + ((float)y + 0.5f) * params.sourceStepY;
  MomentumUInt destinationIndex = y * params.rowPixels + x;
  if (logicalX < 0.0f || logicalY < 0.0f ||
      logicalX >= (float)params.logicalWidth || logicalY >= (float)params.logicalHeight) {
    destination[destinationIndex] = momentum_float4(0.0f, 0.0f, 0.0f, 0.0f);
    return;
  }
  MomentumFloat4 premul = momentum_sample_linear(
    source,
    logicalX / (float)(params.logicalWidth > 0U ? params.logicalWidth : 1U),
    logicalY / (float)(params.logicalHeight > 0U ? params.logicalHeight : 1U),
    params.sourceWidth,
    params.sourceHeight
  );
  float alpha = momentum_clamp(premul.w, 0.0f, 1.0f);
  float red = alpha > 1.0e-6f ? premul.x / alpha : 0.0f;
  float green = alpha > 1.0e-6f ? premul.y / alpha : 0.0f;
  float blue = alpha > 1.0e-6f ? premul.z / alpha : 0.0f;
  destination[destinationIndex] = momentum_float4(blue, green, red, alpha);
}
