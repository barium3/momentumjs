#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <simd/simd.h>

#include "bitmap_gpu_backend.h"
#include "bitmap_gpu_plan.h"
#include "../runtime/runtime_core.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace momentum {

namespace {

std::string SummarizeGpuDrawPlanForTrace(const GpuRenderPlan& plan) {
  std::ostringstream stream;
  stream
    << "clear=" << (plan.clearsSurface ? 1 : 0)
    << ",ca=" << static_cast<int>(plan.clearColor.alpha)
    << ",fills=" << plan.fillTriangles.size()
    << ",strokes=" << plan.strokeTriangles.size()
    << ",paths=" << plan.pathFills.size()
    << ",images=" << plan.imageDraws.size()
    << ",filters=" << plan.filterPasses.size()
    << ",masks=" << plan.maskPasses.size();
  return stream.str();
}

static NSString* const kBitmapGpuShaderSource =
  @"#include <metal_stdlib>\n"
   "using namespace metal;\n"
   "struct ViewportUniforms {\n"
   "  float2 viewportSize;\n"
   "};\n"
   "struct CopyUniforms {\n"
   "  uint width;\n"
   "  uint height;\n"
   "  uint rowPixels;\n"
   "  uint pad;\n"
   "  uint sourceOriginX;\n"
   "  uint sourceOriginY;\n"
   "  uint logicalWidth;\n"
   "  uint logicalHeight;\n"
   "};\n"
   "struct BlendUniforms {\n"
   "  uint width;\n"
   "  uint height;\n"
   "  int blendMode;\n"
   "  uint erase;\n"
   "  float eraseStrength;\n"
   "};\n"
   "struct FilterUniforms {\n"
   "  uint width;\n"
   "  uint height;\n"
   "  int filterKind;\n"
   "  float value;\n"
   "};\n"
   "struct PathFillContour {\n"
   "  uint vertexStart;\n"
   "  uint vertexCount;\n"
   "};\n"
   "struct PathFillUniforms {\n"
   "  uint regionOriginX;\n"
   "  uint regionOriginY;\n"
   "  uint regionWidth;\n"
   "  uint regionHeight;\n"
   "  uint canvasWidth;\n"
   "  uint canvasHeight;\n"
   "  uint contourStart;\n"
   "  uint contourCount;\n"
   "  uint clipContourStart;\n"
   "  uint clipContourCount;\n"
   "  float2 viewportSize;\n"
   "  float4 color;\n"
   "  float4 bounds;\n"
   "  float4 clipBounds;\n"
   "};\n"
   "struct FillTriangleData {\n"
   "  float2 a;\n"
   "  float2 b;\n"
   "  float2 c;\n"
   "};\n"
   "struct EdgeSegment {\n"
   "  float2 a;\n"
   "  float2 b;\n"
   "};\n"
   "struct EdgeDistanceInfo {\n"
   "  float distance;\n"
   "  float2 a;\n"
   "  float2 b;\n"
   "};\n"
   "struct FillRasterUniforms {\n"
   "  uint regionOriginX;\n"
   "  uint regionOriginY;\n"
   "  uint regionWidth;\n"
   "  uint regionHeight;\n"
   "  uint canvasWidth;\n"
   "  uint canvasHeight;\n"
   "  uint triangleCount;\n"
   "  uint edgeCount;\n"
   "  uint clipContourStart;\n"
   "  uint clipContourCount;\n"
   "  float2 viewportSize;\n"
   "  float4 color;\n"
   "  float4 bounds;\n"
   "  float4 clipBounds;\n"
   "};\n"
   "struct ImageVertex {\n"
   "  float2 position;\n"
   "  float2 uv;\n"
   "  float4 tint;\n"
   "};\n"
   "struct ImageVertexOut {\n"
   "  float4 position [[position]];\n"
   "  float2 worldPoint;\n"
   "  float2 uv;\n"
   "  float4 tint;\n"
   "};\n"
   "float distance_to_segment(float2 point, float2 start, float2 end) {\n"
   "  float2 delta = end - start;\n"
   "  float lengthSquared = max(dot(delta, delta), 1e-6f);\n"
   "  float t = clamp(dot(point - start, delta) / lengthSquared, 0.0f, 1.0f);\n"
   "  float2 projection = start + delta * t;\n"
   "  return length(point - projection);\n"
   "}\n"
   "bool point_in_triangle(float2 point, float2 a, float2 b, float2 c) {\n"
   "  float2 v0 = b - a;\n"
   "  float2 v1 = c - b;\n"
   "  float2 v2 = a - c;\n"
   "  float c0 = v0.x * (point.y - a.y) - v0.y * (point.x - a.x);\n"
   "  float c1 = v1.x * (point.y - b.y) - v1.y * (point.x - b.x);\n"
   "  float c2 = v2.x * (point.y - c.y) - v2.y * (point.x - c.x);\n"
   "  bool hasNeg = (c0 < 0.0f) || (c1 < 0.0f) || (c2 < 0.0f);\n"
   "  bool hasPos = (c0 > 0.0f) || (c1 > 0.0f) || (c2 > 0.0f);\n"
   "  return !(hasNeg && hasPos);\n"
   "}\n"
   "float edge_coverage_from_signed_distance(float signedDistance) {\n"
   "  constexpr float aaHalfWidth = 0.5f;\n"
   "  return clamp((aaHalfWidth - signedDistance) / (aaHalfWidth * 2.0f), 0.0f, 1.0f);\n"
   "}\n"
   "bool point_in_any_fill_triangle(float2 point, device const FillTriangleData* triangles, uint triangleCount) {\n"
   "  for (uint triangleIndex = 0; triangleIndex < triangleCount; ++triangleIndex) {\n"
   "    FillTriangleData triangle = triangles[triangleIndex];\n"
   "    if (point_in_triangle(point, triangle.a, triangle.b, triangle.c)) {\n"
   "      return true;\n"
   "    }\n"
   "  }\n"
   "  return false;\n"
   "}\n"
   "EdgeDistanceInfo nearest_fill_edge_info(float2 point, device const EdgeSegment* edges, uint edgeCount) {\n"
   "  EdgeDistanceInfo info;\n"
   "  info.distance = INFINITY;\n"
   "  info.a = float2(0.0f);\n"
   "  info.b = float2(0.0f);\n"
   "  for (uint edgeIndex = 0; edgeIndex < edgeCount; ++edgeIndex) {\n"
   "    EdgeSegment edge = edges[edgeIndex];\n"
   "    float distanceValue = distance_to_segment(point, edge.a, edge.b);\n"
   "    if (distanceValue < info.distance) {\n"
   "      info.distance = distanceValue;\n"
   "      info.a = edge.a;\n"
   "      info.b = edge.b;\n"
   "    }\n"
   "  }\n"
   "  return info;\n"
   "}\n"
   "int winding_at_point(float2 point, device const float2* vertices, device const PathFillContour* contours, uint contourStart, uint contourCount) {\n"
   "  int winding = 0;\n"
   "  for (uint contourIndex = 0; contourIndex < contourCount; ++contourIndex) {\n"
   "    PathFillContour contour = contours[contourStart + contourIndex];\n"
   "    if (contour.vertexCount < 2u) {\n"
   "      continue;\n"
   "    }\n"
   "    for (uint vertexIndex = 0; vertexIndex < contour.vertexCount; ++vertexIndex) {\n"
   "      float2 a = vertices[contour.vertexStart + vertexIndex];\n"
   "      float2 b = vertices[contour.vertexStart + ((vertexIndex + 1u) % contour.vertexCount)];\n"
   "      bool upward = (a.y <= point.y) && (b.y > point.y);\n"
   "      bool downward = (a.y > point.y) && (b.y <= point.y);\n"
   "      if (!upward && !downward) {\n"
   "        continue;\n"
   "      }\n"
   "      float cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);\n"
   "      if (upward && cross > 0.0f) {\n"
   "        winding += 1;\n"
   "      } else if (downward && cross < 0.0f) {\n"
   "        winding -= 1;\n"
   "      }\n"
   "    }\n"
   "  }\n"
   "  return winding;\n"
   "}\n"
   "EdgeDistanceInfo nearest_path_edge_info(float2 point, device const float2* vertices, device const PathFillContour* contours, uint contourStart, uint contourCount) {\n"
   "  EdgeDistanceInfo info;\n"
   "  info.distance = INFINITY;\n"
   "  info.a = float2(0.0f);\n"
   "  info.b = float2(0.0f);\n"
   "  for (uint contourIndex = 0; contourIndex < contourCount; ++contourIndex) {\n"
   "    PathFillContour contour = contours[contourStart + contourIndex];\n"
   "    if (contour.vertexCount < 2u) {\n"
   "      continue;\n"
   "    }\n"
   "    for (uint vertexIndex = 0; vertexIndex < contour.vertexCount; ++vertexIndex) {\n"
   "      float2 a = vertices[contour.vertexStart + vertexIndex];\n"
   "      float2 b = vertices[contour.vertexStart + ((vertexIndex + 1u) % contour.vertexCount)];\n"
   "      float distanceValue = distance_to_segment(point, a, b);\n"
   "      if (distanceValue < info.distance) {\n"
   "        info.distance = distanceValue;\n"
   "        info.a = a;\n"
   "        info.b = b;\n"
   "      }\n"
   "    }\n"
   "  }\n"
   "  return info;\n"
   "}\n"
   "bool edge_is_axis_aligned(float2 a, float2 b) {\n"
   "  float2 delta = fabs(b - a);\n"
   "  return delta.x <= 1e-3f || delta.y <= 1e-3f;\n"
   "}\n"
   "bool edge_is_pixel_aligned(float2 a, float2 b) {\n"
   "  float2 delta = fabs(b - a);\n"
   "  if (delta.x <= 1e-3f) {\n"
   "    return fabs(a.x - round(a.x)) <= 0.125f;\n"
   "  }\n"
   "  if (delta.y <= 1e-3f) {\n"
   "    return fabs(a.y - round(a.y)) <= 0.125f;\n"
   "  }\n"
   "  return false;\n"
   "}\n"
   "float resolve_edge_coverage(float signedDistance, float2 a, float2 b) {\n"
   "  if (edge_is_axis_aligned(a, b) && edge_is_pixel_aligned(a, b)) {\n"
   "    return signedDistance < 0.0f ? 1.0f : 0.0f;\n"
   "  }\n"
   "  return edge_coverage_from_signed_distance(signedDistance);\n"
   "}\n"
   "float sample_clip_alpha(texture2d<float> clipTexture, float2 worldPoint, float2 viewportSize) {\n"
   "  constexpr sampler clipSampler(coord::normalized, address::clamp_to_edge, filter::linear);\n"
   "  float2 uv = float2(\n"
   "    viewportSize.x > 0.0f ? worldPoint.x / viewportSize.x : 0.0f,\n"
   "    viewportSize.y > 0.0f ? worldPoint.y / viewportSize.y : 0.0f);\n"
   "  return clamp(clipTexture.sample(clipSampler, uv).a, 0.0f, 1.0f);\n"
   "}\n"
   "float analytic_clip_coverage(float2 point, device const float2* vertices, device const PathFillContour* contours, uint contourStart, uint contourCount, float4 clipBounds) {\n"
   "  if (contourCount == 0u) {\n"
   "    return 1.0f;\n"
   "  }\n"
   "  if (point.x < clipBounds.x - 1.0f || point.y < clipBounds.y - 1.0f || point.x > clipBounds.z + 1.0f || point.y > clipBounds.w + 1.0f) {\n"
   "    return 0.0f;\n"
   "  }\n"
   "  bool inside = winding_at_point(point, vertices, contours, contourStart, contourCount) != 0;\n"
   "  EdgeDistanceInfo edgeInfo = nearest_path_edge_info(point, vertices, contours, contourStart, contourCount);\n"
   "  float signedDistance = inside ? -edgeInfo.distance : edgeInfo.distance;\n"
   "  return resolve_edge_coverage(signedDistance, edgeInfo.a, edgeInfo.b);\n"
   "}\n"
   "vertex ImageVertexOut image_vertex(\n"
   "  uint vertexId [[vertex_id]],\n"
   "  constant ImageVertex* vertices [[buffer(0)]],\n"
   "  constant ViewportUniforms& viewport [[buffer(1)]]) {\n"
   "  ImageVertex value = vertices[vertexId];\n"
   "  float clipX = viewport.viewportSize.x > 0.0f ? (value.position.x / viewport.viewportSize.x) * 2.0f - 1.0f : -1.0f;\n"
   "  float clipY = viewport.viewportSize.y > 0.0f ? 1.0f - (value.position.y / viewport.viewportSize.y) * 2.0f : 1.0f;\n"
   "  ImageVertexOut out;\n"
   "  out.position = float4(clipX, clipY, 0.0f, 1.0f);\n"
   "  out.worldPoint = value.position;\n"
   "  out.uv = value.uv;\n"
   "  out.tint = value.tint;\n"
   "  return out;\n"
   "}\n"
   "fragment float4 image_fragment(\n"
  "  ImageVertexOut in [[stage_in]],\n"
  "  constant ViewportUniforms& viewport [[buffer(0)]],\n"
  "  texture2d<float> imageTexture [[texture(0)]],\n"
  "  texture2d<float> clipTexture [[texture(1)]]) {\n"
  "  constexpr sampler imageSampler(coord::normalized, address::clamp_to_edge, filter::linear);\n"
   "  float4 sampledPremul = imageTexture.sample(imageSampler, in.uv);\n"
   "  float sampledAlpha = clamp(sampledPremul.a, 0.0f, 1.0f);\n"
   "  float3 sampledStraight = sampledAlpha > 1e-6f ? sampledPremul.rgb / sampledAlpha : float3(0.0f);\n"
   "  float3 tintedStraight = sampledStraight * in.tint.rgb;\n"
   "  float clipAlpha = sample_clip_alpha(clipTexture, in.worldPoint, viewport.viewportSize);\n"
   "  float alpha = sampledAlpha * in.tint.a * clipAlpha;\n"
   "  return float4(tintedStraight * alpha, alpha);\n"
   "}\n"
   "fragment float4 text_image_fragment(\n"
   "  ImageVertexOut in [[stage_in]],\n"
   "  constant ViewportUniforms& viewport [[buffer(0)]],\n"
   "  texture2d<float> imageTexture [[texture(0)]],\n"
   "  texture2d<float> clipTexture [[texture(1)]]) {\n"
   "  constexpr sampler imageSampler(coord::normalized, address::clamp_to_edge, filter::linear);\n"
   "  float4 sampledPremul = imageTexture.sample(imageSampler, in.uv);\n"
   "  float sampledAlpha = clamp(sampledPremul.a, 0.0f, 1.0f);\n"
   "  float3 sampledStraight = sampledAlpha > 1e-6f ? sampledPremul.rgb / sampledAlpha : float3(0.0f);\n"
   "  float3 tintedStraight = sampledStraight * in.tint.rgb;\n"
   "  float clipAlpha = sample_clip_alpha(clipTexture, in.worldPoint, viewport.viewportSize);\n"
   "  float alpha = sampledAlpha * in.tint.a * clipAlpha;\n"
   "  return float4(tintedStraight * alpha, alpha);\n"
   "}\n"
   "float softlight_d(float backdrop) {\n"
   "  return backdrop <= 0.25f\n"
   "    ? ((16.0f * backdrop - 12.0f) * backdrop + 4.0f) * backdrop\n"
   "    : sqrt(backdrop);\n"
   "}\n"
   "float canvas_blend_channel(float backdrop, float source, int blendMode) {\n"
   "  switch (blendMode) {\n"
   "    case 402: return min(backdrop, source);\n"
   "    case 403: return max(backdrop, source);\n"
   "    case 404: return fabs(backdrop - source);\n"
   "    case 405: return backdrop + source - 2.0f * backdrop * source;\n"
   "    case 406: return backdrop * source;\n"
   "    case 407: return backdrop + source - backdrop * source;\n"
   "    case 410: return backdrop <= 0.5f\n"
   "      ? 2.0f * backdrop * source\n"
   "      : 1.0f - 2.0f * (1.0f - backdrop) * (1.0f - source);\n"
   "    case 411: return source <= 0.5f\n"
   "      ? 2.0f * backdrop * source\n"
   "      : 1.0f - 2.0f * (1.0f - backdrop) * (1.0f - source);\n"
   "    case 412: return source <= 0.5f\n"
   "      ? backdrop - (1.0f - 2.0f * source) * backdrop * (1.0f - backdrop)\n"
   "      : backdrop + (2.0f * source - 1.0f) * (softlight_d(backdrop) - backdrop);\n"
   "    case 413: return source >= 1.0f\n"
   "      ? 1.0f\n"
   "      : min(1.0f, backdrop / max(1.0f - source, 1e-5f));\n"
   "    case 414: return source <= 0.0f\n"
   "      ? 0.0f\n"
   "      : 1.0f - min(1.0f, (1.0f - backdrop) / max(source, 1e-5f));\n"
   "    case 400:\n"
   "    default:\n"
   "      return source;\n"
   "  }\n"
   "}\n"
   "float3 canvas_blend_rgb(float3 backdrop, float3 source, int blendMode) {\n"
   "  return float3(\n"
   "    canvas_blend_channel(backdrop.r, source.r, blendMode),\n"
   "    canvas_blend_channel(backdrop.g, source.g, blendMode),\n"
   "    canvas_blend_channel(backdrop.b, source.b, blendMode)\n"
   "  );\n"
   "}\n"
   "kernel void rasterize_fill_analytic(\n"
   "  device const FillTriangleData* triangles [[buffer(0)]],\n"
   "  device const EdgeSegment* edges [[buffer(1)]],\n"
   "  constant FillRasterUniforms& uniforms [[buffer(2)]],\n"
   "  device const float2* clipVertices [[buffer(3)]],\n"
   "  device const PathFillContour* clipContours [[buffer(4)]],\n"
   "  texture2d<float, access::read_write> destinationTexture [[texture(0)]],\n"
   "  texture2d<float> clipTexture [[texture(1)]],\n"
   "  uint2 gid [[thread_position_in_grid]]) {\n"
   "  if (gid.x >= uniforms.regionWidth || gid.y >= uniforms.regionHeight) {\n"
   "    return;\n"
   "  }\n"
   "  const uint px = uniforms.regionOriginX + gid.x;\n"
   "  const uint py = uniforms.regionOriginY + gid.y;\n"
   "  if (px >= uniforms.canvasWidth || py >= uniforms.canvasHeight) {\n"
   "    return;\n"
   "  }\n"
   "  const float2 point = float2(float(px) + 0.5f, float(py) + 0.5f);\n"
   "  if (point.x < uniforms.bounds.x - 1.0f || point.y < uniforms.bounds.y - 1.0f ||\n"
   "      point.x > uniforms.bounds.z + 1.0f || point.y > uniforms.bounds.w + 1.0f) {\n"
   "    return;\n"
   "  }\n"
   "  const bool inside = point_in_any_fill_triangle(point, triangles, uniforms.triangleCount);\n"
   "  if (!inside && uniforms.edgeCount == 0u) {\n"
   "    return;\n"
   "  }\n"
   "  const EdgeDistanceInfo edgeInfo = uniforms.edgeCount > 0u\n"
   "    ? nearest_fill_edge_info(point, edges, uniforms.edgeCount)\n"
   "    : EdgeDistanceInfo{inside ? 0.0f : INFINITY, float2(0.0f), float2(0.0f)};\n"
   "  const float nearestDistance = edgeInfo.distance;\n"
   "  const float signedDistance = inside ? -nearestDistance : nearestDistance;\n"
   "  const float coverage = resolve_edge_coverage(signedDistance, edgeInfo.a, edgeInfo.b);\n"
   "  if (coverage <= 1e-6f) {\n"
   "    return;\n"
   "  }\n"
   "  float clipAlpha = uniforms.clipContourCount > 0u\n"
   "    ? analytic_clip_coverage(point, clipVertices, clipContours, uniforms.clipContourStart, uniforms.clipContourCount, uniforms.clipBounds)\n"
   "    : sample_clip_alpha(clipTexture, point, uniforms.viewportSize);\n"
   "  float srcA = clamp(uniforms.color.a * coverage * clipAlpha, 0.0f, 1.0f);\n"
   "  if (srcA <= 1e-6f) {\n"
   "    return;\n"
   "  }\n"
   "  float4 src = float4(uniforms.color.rgb * srcA, srcA);\n"
   "  float4 dst = destinationTexture.read(uint2(px, py));\n"
   "  float oneMinusSrcA = 1.0f - srcA;\n"
   "  float4 outColor = float4(src.rgb + dst.rgb * oneMinusSrcA, srcA + dst.a * oneMinusSrcA);\n"
   "  destinationTexture.write(outColor, uint2(px, py));\n"
   "}\n"
   "kernel void rasterize_path_fill_nonzero(\n"
   "  device const float2* vertices [[buffer(0)]],\n"
   "  device const PathFillContour* contours [[buffer(1)]],\n"
   "  constant PathFillUniforms& uniforms [[buffer(2)]],\n"
   "  texture2d<float, access::read_write> destinationTexture [[texture(0)]],\n"
   "  texture2d<float> clipTexture [[texture(1)]],\n"
   "  uint2 gid [[thread_position_in_grid]]) {\n"
   "  if (gid.x >= uniforms.regionWidth || gid.y >= uniforms.regionHeight) {\n"
   "    return;\n"
   "  }\n"
   "  const uint px = uniforms.regionOriginX + gid.x;\n"
   "  const uint py = uniforms.regionOriginY + gid.y;\n"
   "  if (px >= uniforms.canvasWidth || py >= uniforms.canvasHeight) {\n"
   "    return;\n"
   "  }\n"
   "  const float2 point = float2(float(px) + 0.5f, float(py) + 0.5f);\n"
   "  if (point.x < uniforms.bounds.x - 1.0f || point.y < uniforms.bounds.y - 1.0f ||\n"
   "      point.x > uniforms.bounds.z + 1.0f || point.y > uniforms.bounds.w + 1.0f) {\n"
   "    return;\n"
   "  }\n"
   "  bool inside = winding_at_point(point, vertices, contours, uniforms.contourStart, uniforms.contourCount) != 0;\n"
   "  EdgeDistanceInfo edgeInfo = nearest_path_edge_info(point, vertices, contours, uniforms.contourStart, uniforms.contourCount);\n"
   "  float nearestDistance = edgeInfo.distance;\n"
   "  float signedDistance = inside ? -nearestDistance : nearestDistance;\n"
   "  float coverage = resolve_edge_coverage(signedDistance, edgeInfo.a, edgeInfo.b);\n"
   "  if (coverage <= 1e-6f) {\n"
   "    return;\n"
   "  }\n"
   "  float clipAlpha = uniforms.clipContourCount > 0u\n"
   "    ? analytic_clip_coverage(point, vertices, contours, uniforms.clipContourStart, uniforms.clipContourCount, uniforms.clipBounds)\n"
   "    : sample_clip_alpha(clipTexture, point, uniforms.viewportSize);\n"
   "  float srcA = clamp(uniforms.color.a * coverage * clipAlpha, 0.0f, 1.0f);\n"
   "  if (srcA <= 1e-6f) {\n"
   "    return;\n"
   "  }\n"
   "  float4 src = float4(uniforms.color.rgb * srcA, srcA);\n"
   "  float4 dst = destinationTexture.read(uint2(px, py));\n"
   "  float oneMinusSrcA = 1.0f - srcA;\n"
   "  float4 outColor = float4(src.rgb + dst.rgb * oneMinusSrcA, srcA + dst.a * oneMinusSrcA);\n"
   "  destinationTexture.write(outColor, uint2(px, py));\n"
   "}\n"
   "kernel void composite_texture(\n"
   "  texture2d<float, access::read> sourceTexture [[texture(0)]],\n"
   "  texture2d<float, access::read_write> destinationTexture [[texture(1)]],\n"
   "  constant BlendUniforms& uniforms [[buffer(0)]],\n"
   "  uint2 gid [[thread_position_in_grid]]) {\n"
   "  if (gid.x >= uniforms.width || gid.y >= uniforms.height) {\n"
   "    return;\n"
   "  }\n"
   "  float4 srcPremul = sourceTexture.read(gid);\n"
   "  float4 dstPremul = destinationTexture.read(gid);\n"
   "  float srcA = clamp(srcPremul.a, 0.0f, 1.0f);\n"
   "  float dstA = clamp(dstPremul.a, 0.0f, 1.0f);\n"
   "  float3 src = srcA > 1e-6f ? srcPremul.rgb / srcA : float3(0.0f);\n"
   "  float3 dst = dstA > 1e-6f ? dstPremul.rgb / dstA : float3(0.0f);\n"
   "  if (uniforms.erase != 0u || uniforms.blendMode == 409) {\n"
   "    float removal = clamp(srcA * (uniforms.erase != 0u ? uniforms.eraseStrength : 1.0f), 0.0f, 1.0f);\n"
   "    float keep = 1.0f - removal;\n"
   "    destinationTexture.write(float4(dstPremul.rgb * keep, dstA * keep), gid);\n"
   "    return;\n"
   "  }\n"
   "  if (uniforms.blendMode == 401) {\n"
   "    float4 sumPremul = clamp(dstPremul + srcPremul, 0.0f, 1.0f);\n"
   "    destinationTexture.write(sumPremul, gid);\n"
   "    return;\n"
   "  }\n"
   "  if (uniforms.blendMode == 408) {\n"
   "    destinationTexture.write(srcPremul, gid);\n"
   "    return;\n"
   "  }\n"
   "  float3 blended = canvas_blend_rgb(dst, src, uniforms.blendMode);\n"
   "  float outA = clamp(srcA + dstA - srcA * dstA, 0.0f, 1.0f);\n"
   "  float3 outPremul =\n"
   "    (1.0f - dstA) * srcA * src +\n"
   "    (1.0f - srcA) * dstA * dst +\n"
   "    srcA * dstA * blended;\n"
   "  destinationTexture.write(float4(clamp(outPremul, 0.0f, 1.0f), outA), gid);\n"
   "}\n"
   "float4 copy_read_clamped(texture2d<float, access::read> texture, int2 point) {\n"
   "  int maxX = max(int(texture.get_width()) - 1, 0);\n"
   "  int maxY = max(int(texture.get_height()) - 1, 0);\n"
   "  uint2 clamped = uint2(uint(clamp(point.x, 0, maxX)), uint(clamp(point.y, 0, maxY)));\n"
   "  return texture.read(clamped);\n"
   "}\n"
   "float4 copy_sample_linear(texture2d<float, access::read> texture, float2 uv) {\n"
   "  float2 clampedUv = clamp(uv, float2(0.0f), float2(1.0f));\n"
   "  float2 sourceSize = float2(float(max(texture.get_width(), 1u)), float(max(texture.get_height(), 1u)));\n"
   "  float2 sourcePoint = clampedUv * sourceSize - 0.5f;\n"
   "  float2 base = floor(sourcePoint);\n"
   "  float2 frac = sourcePoint - base;\n"
   "  int2 p00 = int2(base);\n"
   "  int2 p10 = p00 + int2(1, 0);\n"
   "  int2 p01 = p00 + int2(0, 1);\n"
   "  int2 p11 = p00 + int2(1, 1);\n"
   "  float4 c00 = copy_read_clamped(texture, p00);\n"
   "  float4 c10 = copy_read_clamped(texture, p10);\n"
   "  float4 c01 = copy_read_clamped(texture, p01);\n"
   "  float4 c11 = copy_read_clamped(texture, p11);\n"
   "  float4 c0 = mix(c00, c10, frac.x);\n"
   "  float4 c1 = mix(c01, c11, frac.x);\n"
   "  return mix(c0, c1, frac.y);\n"
   "}\n"
   "kernel void copy_texture_to_output(\n"
   "  texture2d<float, access::read> sourceTexture [[texture(0)]],\n"
   "  device float4* destination [[buffer(0)]],\n"
   "  constant CopyUniforms& uniforms [[buffer(1)]],\n"
   "  uint2 gid [[thread_position_in_grid]]) {\n"
   "  if (gid.x >= uniforms.width || gid.y >= uniforms.height) {\n"
   "    return;\n"
   "  }\n"
   "  float logicalWidth = max(float(uniforms.logicalWidth), 1.0f);\n"
   "  float logicalHeight = max(float(uniforms.logicalHeight), 1.0f);\n"
   "  float2 logicalPoint = float2(float(gid.x + uniforms.sourceOriginX) + 0.5f, float(gid.y + uniforms.sourceOriginY) + 0.5f);\n"
   "  if (logicalPoint.x < 0.0f || logicalPoint.y < 0.0f || logicalPoint.x > logicalWidth || logicalPoint.y > logicalHeight) {\n"
   "    const uint index = gid.y * uniforms.rowPixels + gid.x;\n"
   "    destination[index] = float4(0.0f);\n"
   "    return;\n"
   "  }\n"
   "  float4 premultiplied;\n"
   "  if (uniforms.logicalWidth == sourceTexture.get_width() && uniforms.logicalHeight == sourceTexture.get_height()) {\n"
   "    uint2 sourceGid = uint2(gid.x + uniforms.sourceOriginX, gid.y + uniforms.sourceOriginY);\n"
   "    if (sourceGid.x >= sourceTexture.get_width() || sourceGid.y >= sourceTexture.get_height()) {\n"
   "      const uint index = gid.y * uniforms.rowPixels + gid.x;\n"
   "      destination[index] = float4(0.0f);\n"
   "      return;\n"
   "    }\n"
   "    premultiplied = sourceTexture.read(sourceGid);\n"
   "  } else {\n"
   "    float2 uv = float2(logicalPoint.x / logicalWidth, logicalPoint.y / logicalHeight);\n"
   "    premultiplied = copy_sample_linear(sourceTexture, uv);\n"
   "  }\n"
   "  float alpha = premultiplied.a;\n"
   "  float3 straight = alpha > 1e-6f ? premultiplied.rgb / alpha : float3(0.0f);\n"
   "  const uint index = gid.y * uniforms.rowPixels + gid.x;\n"
   "  destination[index] = float4(straight.b, straight.g, straight.r, alpha);\n"
   "}\n"
   "float3 filter_straight(float4 premul) {\n"
   "  float a = clamp(premul.a, 0.0f, 1.0f);\n"
   "  return a > 1e-6f ? premul.rgb / a : float3(0.0f);\n"
   "}\n"
   "float filter_luma(float3 rgb) {\n"
   "  return dot(rgb, float3(0.299f, 0.587f, 0.114f));\n"
   "}\n"
   "float4 read_clamped(texture2d<float, access::read> texture, int2 p, uint width, uint height) {\n"
   "  int x = clamp(p.x, 0, max(int(width) - 1, 0));\n"
   "  int y = clamp(p.y, 0, max(int(height) - 1, 0));\n"
   "  return texture.read(uint2(uint(x), uint(y)));\n"
   "}\n"
   "kernel void copy_texture_raw(\n"
   "  texture2d<float, access::read> sourceTexture [[texture(0)]],\n"
   "  texture2d<float, access::write> destinationTexture [[texture(1)]],\n"
   "  constant CopyUniforms& uniforms [[buffer(0)]],\n"
   "  uint2 gid [[thread_position_in_grid]]) {\n"
   "  if (gid.x >= uniforms.width || gid.y >= uniforms.height) {\n"
   "    return;\n"
   "  }\n"
   "  destinationTexture.write(sourceTexture.read(gid), gid);\n"
   "}\n"
   "kernel void apply_filter_texture(\n"
   "  texture2d<float, access::read> sourceTexture [[texture(0)]],\n"
   "  texture2d<float, access::write> destinationTexture [[texture(1)]],\n"
   "  constant FilterUniforms& uniforms [[buffer(0)]],\n"
   "  uint2 gid [[thread_position_in_grid]]) {\n"
   "  if (gid.x >= uniforms.width || gid.y >= uniforms.height) {\n"
   "    return;\n"
   "  }\n"
   "  float4 srcPremul = sourceTexture.read(gid);\n"
   "  float srcA = clamp(srcPremul.a, 0.0f, 1.0f);\n"
   "  float3 srcStraight = filter_straight(srcPremul);\n"
   "  float outA = srcA;\n"
   "  float3 outStraight = srcStraight;\n"
   "  if (uniforms.filterKind == 1) {\n"
   "    float gray = filter_luma(srcStraight);\n"
   "    outStraight = float3(gray);\n"
   "  } else if (uniforms.filterKind == 2) {\n"
   "    outStraight = float3(1.0f) - srcStraight;\n"
   "  } else if (uniforms.filterKind == 3) {\n"
   "    outA = 1.0f;\n"
   "  } else if (uniforms.filterKind == 4) {\n"
   "    float threshold = uniforms.value > 0.0f ? clamp(uniforms.value, 0.0f, 1.0f) : 0.5f;\n"
   "    float gray = filter_luma(srcStraight);\n"
   "    float value = gray >= threshold ? 1.0f : 0.0f;\n"
   "    outStraight = float3(value);\n"
   "  } else if (uniforms.filterKind == 5) {\n"
   "    float levels = max(2.0f, round(uniforms.value));\n"
   "    float step = 1.0f / max(levels - 1.0f, 1.0f);\n"
   "    outStraight = clamp(round(srcStraight / step) * step, 0.0f, 1.0f);\n"
   "  } else if (uniforms.filterKind == 6) {\n"
   "    int radius = int(round(uniforms.value > 0.0f ? uniforms.value : 1.0f));\n"
   "    radius = clamp(radius, 1, 16);\n"
   "    float3 sumStraight = float3(0.0f);\n"
   "    float sumA = 0.0f;\n"
   "    int count = 0;\n"
   "    for (int oy = -16; oy <= 16; ++oy) {\n"
   "      if (abs(oy) > radius) {\n"
   "        continue;\n"
   "      }\n"
   "      for (int ox = -16; ox <= 16; ++ox) {\n"
   "        if (abs(ox) > radius) {\n"
   "          continue;\n"
   "        }\n"
   "        float4 samplePremul = read_clamped(sourceTexture, int2(int(gid.x) + ox, int(gid.y) + oy), uniforms.width, uniforms.height);\n"
   "        float sampleA = clamp(samplePremul.a, 0.0f, 1.0f);\n"
   "        sumStraight += filter_straight(samplePremul);\n"
   "        sumA += sampleA;\n"
   "        count += 1;\n"
   "      }\n"
   "    }\n"
   "    if (count > 0) {\n"
   "      outStraight = sumStraight / float(count);\n"
   "      outA = sumA / float(count);\n"
   "    }\n"
   "  } else if (uniforms.filterKind == 7 || uniforms.filterKind == 8) {\n"
   "    bool erode = uniforms.filterKind == 7;\n"
   "    float4 chosenPremul = srcPremul;\n"
   "    float chosenLuma = filter_luma(srcStraight);\n"
   "    for (int oy = -1; oy <= 1; ++oy) {\n"
   "      for (int ox = -1; ox <= 1; ++ox) {\n"
   "        float4 samplePremul = read_clamped(sourceTexture, int2(int(gid.x) + ox, int(gid.y) + oy), uniforms.width, uniforms.height);\n"
   "        float sampleLuma = filter_luma(filter_straight(samplePremul));\n"
   "        bool replace = (erode && sampleLuma < chosenLuma) || (!erode && sampleLuma > chosenLuma);\n"
   "        if (replace) {\n"
   "          chosenPremul = samplePremul;\n"
   "          chosenLuma = sampleLuma;\n"
   "        }\n"
   "      }\n"
   "    }\n"
   "    outA = clamp(chosenPremul.a, 0.0f, 1.0f);\n"
   "    outStraight = filter_straight(chosenPremul);\n"
   "  }\n"
   "  outA = clamp(outA, 0.0f, 1.0f);\n"
   "  outStraight = clamp(outStraight, 0.0f, 1.0f);\n"
   "  destinationTexture.write(float4(outStraight * outA, outA), gid);\n"
   "}\n"
   "kernel void apply_mask_texture(\n"
   "  texture2d<float, access::read> sourceTexture [[texture(0)]],\n"
   "  texture2d<float, access::read> maskTexture [[texture(1)]],\n"
   "  texture2d<float, access::write> destinationTexture [[texture(2)]],\n"
   "  constant CopyUniforms& uniforms [[buffer(0)]],\n"
   "  uint2 gid [[thread_position_in_grid]]) {\n"
   "  if (gid.x >= uniforms.width || gid.y >= uniforms.height) {\n"
   "    return;\n"
   "  }\n"
   "  float4 srcPremul = sourceTexture.read(gid);\n"
   "  float maskAlpha = clamp(maskTexture.read(gid).a, 0.0f, 1.0f);\n"
   "  destinationTexture.write(float4(srcPremul.rgb * maskAlpha, srcPremul.a * maskAlpha), gid);\n"
   "}\n";

struct ScopedAutoreleasePool {
  ScopedAutoreleasePool()
    : pool([[NSAutoreleasePool alloc] init]) {}

  ~ScopedAutoreleasePool() {
    [pool release];
  }

  NSAutoreleasePool* pool = nil;
};

struct GpuBgra128Pixel {
  float blue = 0.0f;
  float green = 0.0f;
  float red = 0.0f;
  float alpha = 0.0f;
};

struct MetalFillTriangleData {
  simd_float2 a;
  simd_float2 b;
  simd_float2 c;
};

struct MetalEdgeSegment {
  simd_float2 a;
  simd_float2 b;
};

struct MetalImageVertex {
  simd_float2 position;
  simd_float2 uv;
  simd_float4 tint;
};

struct ViewportUniforms {
  simd_float2 viewportSize;
};

struct CopyUniforms {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint32_t rowPixels = 0;
  std::uint32_t pad = 0;
  std::uint32_t sourceOriginX = 0;
  std::uint32_t sourceOriginY = 0;
  std::uint32_t logicalWidth = 0;
  std::uint32_t logicalHeight = 0;
};

struct BlendUniforms {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::int32_t blendMode = BLEND_MODE_BLEND;
  std::uint32_t erase = 0;
  float eraseStrength = 1.0f;
};

struct FilterUniforms {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::int32_t filterKind = 0;
  float value = 0.0f;
};

struct MetalPathFillContour {
  std::uint32_t vertexStart = 0;
  std::uint32_t vertexCount = 0;
};

struct PathFillUniforms {
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
  simd_float2 viewportSize;
  simd_float4 color;
  simd_float4 bounds;
  simd_float4 clipBounds;
};

struct FillRasterUniforms {
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
  simd_float2 viewportSize;
  simd_float4 color;
  simd_float4 bounds;
  simd_float4 clipBounds;
};

struct MetalRendererState {
  id<MTLDevice> device = nil;
  id<MTLLibrary> library = nil;
  id<MTLRenderPipelineState> imagePipeline = nil;
  id<MTLRenderPipelineState> textImagePipeline = nil;
  id<MTLComputePipelineState> copyPipeline = nil;
  id<MTLComputePipelineState> textureCopyPipeline = nil;
  id<MTLComputePipelineState> compositePipeline = nil;
  id<MTLComputePipelineState> filterPipeline = nil;
  id<MTLComputePipelineState> maskPipeline = nil;
  id<MTLComputePipelineState> fillAnalyticPipeline = nil;
  id<MTLComputePipelineState> pathFillPipeline = nil;
  id<MTLTexture> whiteMaskTexture = nil;
};

struct MetalBufferSlice {
  id<MTLBuffer> buffer = nil;
  NSUInteger offset = 0;
  NSUInteger length = 0;
};

struct MetalBufferArenaChunk {
  id<MTLBuffer> buffer = nil;
  NSUInteger capacity = 0;
  NSUInteger cursor = 0;
};

struct MetalBufferArena {
  id<MTLDevice> device = nil;
  NSUInteger preferredChunkSize = 0;
  std::vector<MetalBufferArenaChunk> chunks;

  ~MetalBufferArena() {
    for (MetalBufferArenaChunk& chunk : chunks) {
      [chunk.buffer release];
      chunk.buffer = nil;
      chunk.capacity = 0;
      chunk.cursor = 0;
    }
  }
};

struct MetalCanvasState {
  id<MTLTexture> texture = nil;
  id<MTLTexture> scratchTexture = nil;
  A_long width = 0;
  A_long height = 0;
  long lastFrame = 0;
  bool initialized = false;
};

struct MetalCanvasCheckpoint {
  long frame = 0;
  A_long width = 0;
  A_long height = 0;
  id<MTLTexture> texture = nil;
};

struct MetalExactFrameTexture {
  long frame = 0;
  A_long width = 0;
  A_long height = 0;
  id<MTLTexture> texture = nil;
};

std::mutex gMetalRendererMutex;
std::unordered_map<void*, MetalRendererState> gMetalRendererStates;
std::unordered_map<std::uint64_t, MetalCanvasState> gMetalPlaybackCanvasStates;
std::unordered_map<std::uint64_t, MetalCanvasState> gMetalRecoveryCanvasStates;
std::unordered_map<std::uint64_t, std::vector<MetalCanvasCheckpoint>> gMetalCanvasCheckpoints;
std::unordered_map<std::uint64_t, std::vector<MetalExactFrameTexture>> gMetalExactFrameTextures;
std::unordered_map<std::uint64_t, std::shared_ptr<std::mutex>> gMetalCacheRenderLocks;
struct MetalImageTextureState;
void ReleaseMetalCanvasState(MetalCanvasState* state);
void ReleaseMetalCanvasCheckpoint(MetalCanvasCheckpoint* checkpoint);
void ReleaseMetalExactFrameTexture(MetalExactFrameTexture* frameTexture);
void ReleaseMetalImageTextureState(MetalImageTextureState* state);
struct MetalImageTextureState {
  id<MTLTexture> texture = nil;
  id<MTLTexture> scratchTexture = nil;
  int width = 0;
  int height = 0;
  std::uint64_t version = 0;
  bool sceneBacked = false;
};
std::unordered_map<std::uint64_t, std::unordered_map<int, MetalImageTextureState>> gMetalImageTextures;

void ClearMetalExactFrameTexturesUnlocked(std::uint64_t cacheKey) {
  auto exactFrameCacheIt = gMetalExactFrameTextures.find(cacheKey);
  if (exactFrameCacheIt == gMetalExactFrameTextures.end()) {
    return;
  }
  for (auto& frameTexture : exactFrameCacheIt->second) {
    ReleaseMetalExactFrameTexture(&frameTexture);
  }
  gMetalExactFrameTextures.erase(exactFrameCacheIt);
}

void DisposeMetalBitmapStateByCacheKeyUnlocked(std::uint64_t cacheKey) {
  auto imageCacheIt = gMetalImageTextures.find(cacheKey);
  if (imageCacheIt != gMetalImageTextures.end()) {
    for (auto& imageEntry : imageCacheIt->second) {
      ReleaseMetalImageTextureState(&imageEntry.second);
    }
    gMetalImageTextures.erase(imageCacheIt);
  }

  auto playbackCanvasIt = gMetalPlaybackCanvasStates.find(cacheKey);
  if (playbackCanvasIt != gMetalPlaybackCanvasStates.end()) {
    ReleaseMetalCanvasState(&playbackCanvasIt->second);
    gMetalPlaybackCanvasStates.erase(playbackCanvasIt);
  }
  auto recoveryCanvasIt = gMetalRecoveryCanvasStates.find(cacheKey);
  if (recoveryCanvasIt != gMetalRecoveryCanvasStates.end()) {
    ReleaseMetalCanvasState(&recoveryCanvasIt->second);
    gMetalRecoveryCanvasStates.erase(recoveryCanvasIt);
  }
  auto checkpointCacheIt = gMetalCanvasCheckpoints.find(cacheKey);
  if (checkpointCacheIt != gMetalCanvasCheckpoints.end()) {
    for (auto& checkpoint : checkpointCacheIt->second) {
      ReleaseMetalCanvasCheckpoint(&checkpoint);
    }
    gMetalCanvasCheckpoints.erase(checkpointCacheIt);
  }
  ClearMetalExactFrameTexturesUnlocked(cacheKey);

  gMetalCacheRenderLocks.erase(cacheKey);
}

std::shared_ptr<std::mutex> GetOrCreateMetalCacheRenderLock(std::uint64_t cacheKey) {
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  auto& cacheLock = gMetalCacheRenderLocks[cacheKey];
  if (!cacheLock) {
    cacheLock = std::make_shared<std::mutex>();
  }
  return cacheLock;
}

void ReleaseMetalRendererState(MetalRendererState* state) {
  if (!state) {
    return;
  }
  [state->imagePipeline release];
  [state->textImagePipeline release];
  [state->copyPipeline release];
  [state->textureCopyPipeline release];
  [state->compositePipeline release];
  [state->filterPipeline release];
  [state->maskPipeline release];
  [state->fillAnalyticPipeline release];
  [state->pathFillPipeline release];
  [state->whiteMaskTexture release];
  [state->library release];
  state->imagePipeline = nil;
  state->textImagePipeline = nil;
  state->copyPipeline = nil;
  state->textureCopyPipeline = nil;
  state->compositePipeline = nil;
  state->filterPipeline = nil;
  state->maskPipeline = nil;
  state->fillAnalyticPipeline = nil;
  state->pathFillPipeline = nil;
  state->whiteMaskTexture = nil;
  state->library = nil;
  state->device = nil;
}

void ReleaseMetalCanvasState(MetalCanvasState* state) {
  if (!state) {
    return;
  }
  [state->texture release];
  [state->scratchTexture release];
  state->texture = nil;
  state->scratchTexture = nil;
  state->width = 0;
  state->height = 0;
  state->lastFrame = 0;
  state->initialized = false;
}

void ReleaseMetalCanvasCheckpoint(MetalCanvasCheckpoint* checkpoint) {
  if (!checkpoint) {
    return;
  }
  [checkpoint->texture release];
  checkpoint->texture = nil;
  checkpoint->frame = 0;
  checkpoint->width = 0;
  checkpoint->height = 0;
}

void ReleaseMetalExactFrameTexture(MetalExactFrameTexture* frameTexture) {
  if (!frameTexture) {
    return;
  }
  [frameTexture->texture release];
  frameTexture->texture = nil;
  frameTexture->frame = 0;
  frameTexture->width = 0;
  frameTexture->height = 0;
}

void ReleaseMetalImageTextureState(MetalImageTextureState* state) {
  if (!state) {
    return;
  }
  [state->texture release];
  [state->scratchTexture release];
  state->texture = nil;
  state->scratchTexture = nil;
  state->width = 0;
  state->height = 0;
  state->version = 0;
  state->sceneBacked = false;
}

simd_float4 ToStraightFloatColor(const PF_Pixel& color) {
  return simd_make_float4(
    static_cast<float>(static_cast<double>(color.red) / 255.0),
    static_cast<float>(static_cast<double>(color.green) / 255.0),
    static_cast<float>(static_cast<double>(color.blue) / 255.0),
    static_cast<float>(static_cast<double>(color.alpha) / 255.0)
  );
}

NSUInteger AlignMetalBufferOffset(NSUInteger value) {
  constexpr NSUInteger kMetalBufferOffsetAlignment = 256;
  return (value + (kMetalBufferOffsetAlignment - 1)) & ~(kMetalBufferOffsetAlignment - 1);
}

bool UploadToMetalBufferArena(
  MetalBufferArena* arena,
  const void* sourceBytes,
  NSUInteger byteLength,
  const char* debugName,
  MetalBufferSlice* outSlice,
  std::string* errorMessage
) {
  if (!arena || !arena->device || !outSlice) {
    if (errorMessage) {
      *errorMessage = "Metal buffer arena upload is missing required state.";
    }
    return false;
  }

  outSlice->buffer = nil;
  outSlice->offset = 0;
  outSlice->length = byteLength;
  if (byteLength == 0) {
    return true;
  }
  if (!sourceBytes) {
    if (errorMessage) {
      *errorMessage = "Metal buffer arena upload is missing source bytes.";
    }
    return false;
  }

  MetalBufferArenaChunk* selectedChunk = nullptr;
  NSUInteger alignedOffset = 0;
  if (!arena->chunks.empty()) {
    MetalBufferArenaChunk& lastChunk = arena->chunks.back();
    alignedOffset = AlignMetalBufferOffset(lastChunk.cursor);
    if (alignedOffset + byteLength <= lastChunk.capacity) {
      selectedChunk = &lastChunk;
    }
  }

  if (!selectedChunk) {
    const NSUInteger previousCapacity = arena->chunks.empty() ? 0 : arena->chunks.back().capacity;
    const NSUInteger minimumChunkSize = arena->preferredChunkSize > 0
      ? arena->preferredChunkSize
      : static_cast<NSUInteger>(256 * 1024);
    const NSUInteger targetCapacity = std::max(
      AlignMetalBufferOffset(byteLength),
      std::max(minimumChunkSize, previousCapacity > 0 ? previousCapacity * 2 : minimumChunkSize)
    );
    id<MTLBuffer> buffer = [arena->device newBufferWithLength:targetCapacity options:MTLResourceStorageModeShared];
    if (!buffer) {
      if (errorMessage) {
        std::ostringstream stream;
        stream
          << "Failed to allocate Metal shared buffer arena chunk for "
          << (debugName ? debugName : "geometry")
          << " (" << static_cast<unsigned long long>(byteLength) << " bytes requested, chunk="
          << static_cast<unsigned long long>(targetCapacity) << ").";
        *errorMessage = stream.str();
      }
      return false;
    }
    arena->chunks.push_back(MetalBufferArenaChunk{buffer, targetCapacity, 0});
    selectedChunk = &arena->chunks.back();
    alignedOffset = 0;
  }

  std::memcpy(static_cast<std::uint8_t*>([selectedChunk->buffer contents]) + alignedOffset, sourceBytes, byteLength);
  selectedChunk->cursor = alignedOffset + byteLength;
  outSlice->buffer = selectedChunk->buffer;
  outSlice->offset = alignedOffset;
  return true;
}

std::uint32_t FloatBits(float value) {
  std::uint32_t bits = 0;
  static_assert(sizeof(bits) == sizeof(value), "float bit width mismatch");
  std::memcpy(&bits, &value, sizeof(bits));
  return bits;
}

bool PointLessLexicographically(const simd_float2& a, const simd_float2& b) {
  if (a.x != b.x) {
    return a.x < b.x;
  }
  return a.y < b.y;
}

struct FillEdgeKey {
  std::uint32_t ax = 0;
  std::uint32_t ay = 0;
  std::uint32_t bx = 0;
  std::uint32_t by = 0;

  bool operator==(const FillEdgeKey& other) const {
    return ax == other.ax && ay == other.ay && bx == other.bx && by == other.by;
  }
};

struct FillEdgeKeyHash {
  std::size_t operator()(const FillEdgeKey& key) const noexcept {
    std::size_t seed = 1469598103934665603ull;
    auto mix = [&](std::uint32_t value) {
      seed ^= static_cast<std::size_t>(value);
      seed *= 1099511628211ull;
    };
    mix(key.ax);
    mix(key.ay);
    mix(key.bx);
    mix(key.by);
    return seed;
  }
};

struct FillEdgeAccumulator {
  MetalEdgeSegment segment;
  std::uint32_t count = 0;
};

FillEdgeKey MakeFillEdgeKey(simd_float2 a, simd_float2 b) {
  if (PointLessLexicographically(b, a)) {
    std::swap(a, b);
  }
  FillEdgeKey key;
  key.ax = FloatBits(a.x);
  key.ay = FloatBits(a.y);
  key.bx = FloatBits(b.x);
  key.by = FloatBits(b.y);
  return key;
}

void AccumulateFillEdge(
  simd_float2 a,
  simd_float2 b,
  std::unordered_map<FillEdgeKey, FillEdgeAccumulator, FillEdgeKeyHash>* edgeMap
) {
  if (!edgeMap) {
    return;
  }
  if (a.x == b.x && a.y == b.y) {
    return;
  }
  if (PointLessLexicographically(b, a)) {
    std::swap(a, b);
  }
  const FillEdgeKey key = MakeFillEdgeKey(a, b);
  FillEdgeAccumulator& accumulator = (*edgeMap)[key];
  if (accumulator.count == 0) {
    accumulator.segment = MetalEdgeSegment{a, b};
  }
  accumulator.count += 1;
}

struct FillBatchGeometry {
  std::vector<MetalFillTriangleData> triangles;
  std::vector<MetalEdgeSegment> boundaryEdges;
  simd_float4 bounds = simd_make_float4(0.0f, 0.0f, 0.0f, 0.0f);
  bool hasBounds = false;
};

FillBatchGeometry BuildTriangleBatchGeometry(
  const std::vector<GpuRenderPlan::FillTriangle>& trianglesSource,
  const std::vector<GpuRenderPlan::BoundaryEdge>& explicitEdgesSource,
  const GpuRenderPlan::DrawBatch& batch
) {
  FillBatchGeometry geometry;
  if (batch.start + batch.count > trianglesSource.size()) {
    return geometry;
  }

  geometry.triangles.reserve(batch.count);
  const bool useExplicitEdges =
    batch.explicitEdgeCount > 0 &&
    batch.explicitEdgeStart + batch.explicitEdgeCount <= explicitEdgesSource.size();
  std::unordered_map<FillEdgeKey, FillEdgeAccumulator, FillEdgeKeyHash> edgeMap;
  if (!useExplicitEdges) {
    edgeMap.reserve(batch.count * 3U);
  }

  for (std::size_t index = 0; index < batch.count; ++index) {
    const GpuRenderPlan::FillTriangle& triangle = trianglesSource[batch.start + index];
    const simd_float2 a = simd_make_float2(triangle.x1, triangle.y1);
    const simd_float2 b = simd_make_float2(triangle.x2, triangle.y2);
    const simd_float2 c = simd_make_float2(triangle.x3, triangle.y3);
    geometry.triangles.push_back(MetalFillTriangleData{a, b, c});

    if (!useExplicitEdges) {
      AccumulateFillEdge(a, b, &edgeMap);
      AccumulateFillEdge(b, c, &edgeMap);
      AccumulateFillEdge(c, a, &edgeMap);
    }

    const float minX = std::min({a.x, b.x, c.x});
    const float minY = std::min({a.y, b.y, c.y});
    const float maxX = std::max({a.x, b.x, c.x});
    const float maxY = std::max({a.y, b.y, c.y});
    if (!geometry.hasBounds) {
      geometry.bounds = simd_make_float4(minX, minY, maxX, maxY);
      geometry.hasBounds = true;
    } else {
      geometry.bounds.x = std::min(geometry.bounds.x, minX);
      geometry.bounds.y = std::min(geometry.bounds.y, minY);
      geometry.bounds.z = std::max(geometry.bounds.z, maxX);
      geometry.bounds.w = std::max(geometry.bounds.w, maxY);
    }
  }

  if (useExplicitEdges) {
    geometry.boundaryEdges.reserve(batch.explicitEdgeCount);
    for (std::size_t index = 0; index < batch.explicitEdgeCount; ++index) {
      const GpuRenderPlan::BoundaryEdge& edge = explicitEdgesSource[batch.explicitEdgeStart + index];
      geometry.boundaryEdges.push_back(MetalEdgeSegment{
        simd_make_float2(edge.x1, edge.y1),
        simd_make_float2(edge.x2, edge.y2)
      });
    }
  } else {
    geometry.boundaryEdges.reserve(edgeMap.size());
    for (const auto& entry : edgeMap) {
      if ((entry.second.count % 2U) == 1U) {
        geometry.boundaryEdges.push_back(entry.second.segment);
      }
    }
  }

  return geometry;
}

bool EnsureMetalRendererState(
  id<MTLDevice> device,
  MetalRendererState* outState,
  std::string* errorMessage
) {
  if (!device || !outState) {
    if (errorMessage) {
      *errorMessage = "Metal renderer state request is missing a device.";
    }
    return false;
  }

  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  MetalRendererState& state = gMetalRendererStates[reinterpret_cast<void*>(device)];
  if (state.imagePipeline &&
      state.textImagePipeline &&
      state.copyPipeline &&
      state.textureCopyPipeline &&
      state.compositePipeline &&
      state.filterPipeline &&
      state.maskPipeline &&
      state.fillAnalyticPipeline &&
      state.pathFillPipeline &&
      state.whiteMaskTexture) {
    *outState = state;
    return true;
  }

  NSError* shaderError = nil;
  id<MTLLibrary> library = [device newLibraryWithSource:kBitmapGpuShaderSource options:nil error:&shaderError];
  if (!library) {
    if (errorMessage) {
      *errorMessage = shaderError ? [[shaderError localizedDescription] UTF8String] : "Failed to compile Metal shaders.";
    }
    return false;
  }

  id<MTLFunction> imageVertex = [library newFunctionWithName:@"image_vertex"];
  id<MTLFunction> imageFragment = [library newFunctionWithName:@"image_fragment"];
  id<MTLFunction> textImageFragment = [library newFunctionWithName:@"text_image_fragment"];
  id<MTLFunction> copyKernel = [library newFunctionWithName:@"copy_texture_to_output"];
  id<MTLFunction> textureCopyKernel = [library newFunctionWithName:@"copy_texture_raw"];
  id<MTLFunction> compositeKernel = [library newFunctionWithName:@"composite_texture"];
  id<MTLFunction> filterKernel = [library newFunctionWithName:@"apply_filter_texture"];
  id<MTLFunction> maskKernel = [library newFunctionWithName:@"apply_mask_texture"];
  id<MTLFunction> fillAnalyticKernel = [library newFunctionWithName:@"rasterize_fill_analytic"];
  id<MTLFunction> pathFillKernel = [library newFunctionWithName:@"rasterize_path_fill_nonzero"];
  if (!imageVertex ||
      !imageFragment ||
      !textImageFragment ||
      !copyKernel ||
      !textureCopyKernel ||
      !compositeKernel ||
      !filterKernel ||
      !maskKernel ||
      !fillAnalyticKernel ||
      !pathFillKernel) {
    if (errorMessage) {
      *errorMessage = "Failed to find one or more Metal shader entry points.";
    }
    return false;
  }

  MTLRenderPipelineDescriptor* imageDescriptor = [[[MTLRenderPipelineDescriptor alloc] init] autorelease];
  imageDescriptor.vertexFunction = imageVertex;
  imageDescriptor.fragmentFunction = imageFragment;
  imageDescriptor.colorAttachments[0].pixelFormat = MTLPixelFormatRGBA32Float;
  imageDescriptor.colorAttachments[0].blendingEnabled = YES;
  imageDescriptor.colorAttachments[0].rgbBlendOperation = MTLBlendOperationAdd;
  imageDescriptor.colorAttachments[0].alphaBlendOperation = MTLBlendOperationAdd;
  imageDescriptor.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorOne;
  imageDescriptor.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
  imageDescriptor.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
  imageDescriptor.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOneMinusSourceAlpha;

  NSError* pipelineError = nil;
  id<MTLRenderPipelineState> imagePipeline =
    [device newRenderPipelineStateWithDescriptor:imageDescriptor error:&pipelineError];
  if (!imagePipeline) {
    if (errorMessage) {
      *errorMessage = pipelineError ? [[pipelineError localizedDescription] UTF8String] : "Failed to create Metal image pipeline.";
    }
    return false;
  }

  MTLRenderPipelineDescriptor* textImageDescriptor = [[[MTLRenderPipelineDescriptor alloc] init] autorelease];
  textImageDescriptor.vertexFunction = imageVertex;
  textImageDescriptor.fragmentFunction = textImageFragment;
  textImageDescriptor.colorAttachments[0].pixelFormat = MTLPixelFormatRGBA32Float;
  textImageDescriptor.colorAttachments[0].blendingEnabled = YES;
  textImageDescriptor.colorAttachments[0].rgbBlendOperation = MTLBlendOperationAdd;
  textImageDescriptor.colorAttachments[0].alphaBlendOperation = MTLBlendOperationAdd;
  textImageDescriptor.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorOne;
  textImageDescriptor.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
  textImageDescriptor.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
  textImageDescriptor.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOneMinusSourceAlpha;

  pipelineError = nil;
  id<MTLRenderPipelineState> textImagePipeline =
    [device newRenderPipelineStateWithDescriptor:textImageDescriptor error:&pipelineError];
  if (!textImagePipeline) {
    if (errorMessage) {
      *errorMessage = pipelineError ? [[pipelineError localizedDescription] UTF8String] : "Failed to create Metal text image pipeline.";
    }
    return false;
  }

  NSError* computeError = nil;
  id<MTLComputePipelineState> copyPipeline =
    [device newComputePipelineStateWithFunction:copyKernel error:&computeError];
  if (!copyPipeline) {
    if (errorMessage) {
      *errorMessage = computeError ? [[computeError localizedDescription] UTF8String] : "Failed to create Metal copy pipeline.";
    }
    return false;
  }

  computeError = nil;
  id<MTLComputePipelineState> compositePipeline =
    [device newComputePipelineStateWithFunction:compositeKernel error:&computeError];
  if (!compositePipeline) {
    if (errorMessage) {
      *errorMessage = computeError ? [[computeError localizedDescription] UTF8String] : "Failed to create Metal composite pipeline.";
    }
    return false;
  }

  computeError = nil;
  id<MTLComputePipelineState> textureCopyPipeline =
    [device newComputePipelineStateWithFunction:textureCopyKernel error:&computeError];
  if (!textureCopyPipeline) {
    if (errorMessage) {
      *errorMessage = computeError ? [[computeError localizedDescription] UTF8String] : "Failed to create Metal texture-copy pipeline.";
    }
    return false;
  }

  computeError = nil;
  id<MTLComputePipelineState> filterPipeline =
    [device newComputePipelineStateWithFunction:filterKernel error:&computeError];
  if (!filterPipeline) {
    if (errorMessage) {
      *errorMessage = computeError ? [[computeError localizedDescription] UTF8String] : "Failed to create Metal filter pipeline.";
    }
    return false;
  }

  computeError = nil;
  id<MTLComputePipelineState> maskPipeline =
    [device newComputePipelineStateWithFunction:maskKernel error:&computeError];
  if (!maskPipeline) {
    if (errorMessage) {
      *errorMessage = computeError ? [[computeError localizedDescription] UTF8String] : "Failed to create Metal mask pipeline.";
    }
    return false;
  }

  computeError = nil;
  id<MTLComputePipelineState> fillAnalyticPipeline =
    [device newComputePipelineStateWithFunction:fillAnalyticKernel error:&computeError];
  if (!fillAnalyticPipeline) {
    if (errorMessage) {
      *errorMessage = computeError ? [[computeError localizedDescription] UTF8String] : "Failed to create Metal analytic-fill pipeline.";
    }
    return false;
  }

  computeError = nil;
  id<MTLComputePipelineState> pathFillPipeline =
    [device newComputePipelineStateWithFunction:pathFillKernel error:&computeError];
  if (!pathFillPipeline) {
    if (errorMessage) {
      *errorMessage = computeError ? [[computeError localizedDescription] UTF8String] : "Failed to create Metal path-fill pipeline.";
    }
    return false;
  }

  MTLTextureDescriptor* whiteDescriptor =
    [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA32Float
                                                      width:1
                                                     height:1
                                                  mipmapped:NO];
  whiteDescriptor.usage = MTLTextureUsageShaderRead;
  whiteDescriptor.storageMode = MTLStorageModeShared;
  id<MTLTexture> whiteMaskTexture = [device newTextureWithDescriptor:whiteDescriptor];
  if (!whiteMaskTexture) {
    if (errorMessage) {
      *errorMessage = "Failed to allocate default white clip mask texture.";
    }
    return false;
  }
  const simd_float4 whitePixel = simd_make_float4(1.0f, 1.0f, 1.0f, 1.0f);
  [whiteMaskTexture replaceRegion:MTLRegionMake2D(0, 0, 1, 1)
                      mipmapLevel:0
                        withBytes:&whitePixel
                      bytesPerRow:sizeof(simd_float4)];

  state.device = device;
  state.library = library;
  state.imagePipeline = imagePipeline;
  state.textImagePipeline = textImagePipeline;
  state.copyPipeline = copyPipeline;
  state.textureCopyPipeline = textureCopyPipeline;
  state.compositePipeline = compositePipeline;
  state.filterPipeline = filterPipeline;
  state.maskPipeline = maskPipeline;
  state.fillAnalyticPipeline = fillAnalyticPipeline;
  state.pathFillPipeline = pathFillPipeline;
  state.whiteMaskTexture = whiteMaskTexture;
  *outState = state;
  return true;
}

id<MTLTexture> CreateRenderTexture(
  id<MTLDevice> device,
  A_long width,
  A_long height,
  std::string* errorMessage
) {
  if (!device || width <= 0 || height <= 0) {
    if (errorMessage) {
      *errorMessage = "Invalid Metal render texture dimensions.";
    }
    return nil;
  }

  MTLTextureDescriptor* descriptor =
    [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA32Float
                                                      width:static_cast<NSUInteger>(width)
                                                     height:static_cast<NSUInteger>(height)
                                                  mipmapped:NO];
  descriptor.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite;
  descriptor.storageMode = MTLStorageModePrivate;
  return [device newTextureWithDescriptor:descriptor];
}

bool EnsureAccumulationTexture(
  id<MTLDevice> device,
  std::uint64_t cacheKey,
  A_long width,
  A_long height,
  bool useRecoveryCanvas,
  MetalCanvasState* outCache,
  std::string* errorMessage
) {
  if (!outCache) {
    if (errorMessage) {
      *errorMessage = "Metal accumulation cache output is null.";
    }
    return false;
  }

  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  auto& canvasStates = useRecoveryCanvas ? gMetalRecoveryCanvasStates : gMetalPlaybackCanvasStates;
  MetalCanvasState& cache = canvasStates[cacheKey];
  if (!cache.texture || cache.width != width || cache.height != height) {
    ClearMetalExactFrameTexturesUnlocked(cacheKey);
    id<MTLTexture> previousTexture = cache.texture;
    id<MTLTexture> previousScratch = cache.scratchTexture;
    cache.texture = CreateRenderTexture(device, width, height, errorMessage);
    cache.scratchTexture = CreateRenderTexture(device, width, height, errorMessage);
    if (previousTexture && previousTexture != cache.texture) {
      [previousTexture release];
    }
    if (previousScratch && previousScratch != cache.scratchTexture) {
      [previousScratch release];
    }
    cache.width = width;
    cache.height = height;
    cache.lastFrame = 0;
    cache.initialized = false;
  }
  if (!cache.texture || !cache.scratchTexture) {
    return false;
  }
  *outCache = cache;
  return true;
}

bool EnsureImageTexture(
  id<MTLDevice> device,
  std::uint64_t cacheKey,
  const RuntimeImageAsset& asset,
  id<MTLTexture>* outTexture,
  id<MTLTexture>* outScratchTexture,
  bool* outNeedsUpdate,
  std::string* errorMessage
) {
  if (!outTexture) {
    if (errorMessage) {
      *errorMessage = "Image texture output is null.";
    }
    return false;
  }
  if (!device || !asset.loaded || asset.width <= 0 || asset.height <= 0) {
    if (errorMessage) {
      *errorMessage = "Image texture source is invalid.";
    }
    return false;
  }

  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  auto& texturesById = gMetalImageTextures[cacheKey];
  MetalImageTextureState& textureState = texturesById[asset.id];
  const bool sceneBacked = asset.gpuSceneBacked && static_cast<bool>(asset.gpuScene);
  const bool needsRecreate =
    !textureState.texture ||
    textureState.width != asset.width ||
    textureState.height != asset.height ||
    textureState.sceneBacked != sceneBacked;
  if (needsRecreate) {
    id<MTLTexture> previous = textureState.texture;
    id<MTLTexture> previousScratch = textureState.scratchTexture;
    MTLTextureDescriptor* descriptor =
      [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA32Float
                                                        width:static_cast<NSUInteger>(asset.width)
                                                       height:static_cast<NSUInteger>(asset.height)
                                                    mipmapped:NO];
    if (sceneBacked) {
      descriptor.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite;
      descriptor.storageMode = MTLStorageModePrivate;
    } else {
      descriptor.usage = MTLTextureUsageShaderRead;
      descriptor.storageMode = MTLStorageModeShared;
    }
    textureState.texture = [device newTextureWithDescriptor:descriptor];
    if (sceneBacked) {
      textureState.scratchTexture = [device newTextureWithDescriptor:descriptor];
    } else {
      textureState.scratchTexture = nil;
    }
    if (previous && previous != textureState.texture) {
      [previous release];
    }
    if (previousScratch && previousScratch != textureState.scratchTexture) {
      [previousScratch release];
    }
    textureState.width = asset.width;
    textureState.height = asset.height;
    textureState.version = 0;
    textureState.sceneBacked = sceneBacked;
  }
  if (!textureState.texture) {
    if (errorMessage) {
      *errorMessage = "Failed to allocate Metal texture for bitmap image.";
    }
    return false;
  }
  if (sceneBacked && !textureState.scratchTexture) {
    if (errorMessage) {
      *errorMessage = "Failed to allocate Metal scratch texture for scene-backed image.";
    }
    return false;
  }

  const bool needsUpload = textureState.version != asset.version;
  if (!sceneBacked && needsUpload) {
    if (asset.pixels.empty()) {
      if (errorMessage) {
        *errorMessage = "CPU-backed image has no pixels to upload.";
      }
      return false;
    }
    std::vector<simd_float4> rgbaPixels(
      static_cast<std::size_t>(asset.width * asset.height),
      simd_make_float4(0.0f, 0.0f, 0.0f, 0.0f)
    );
    const std::size_t pixelCount = std::min(rgbaPixels.size(), asset.pixels.size());
    for (std::size_t index = 0; index < pixelCount; ++index) {
      const PF_Pixel& pixel = asset.pixels[index];
      const float alpha = static_cast<float>(static_cast<double>(pixel.alpha) / 255.0);
      const float red = static_cast<float>(static_cast<double>(pixel.red) / 255.0);
      const float green = static_cast<float>(static_cast<double>(pixel.green) / 255.0);
      const float blue = static_cast<float>(static_cast<double>(pixel.blue) / 255.0);
      rgbaPixels[index] = simd_make_float4(
        red * alpha,
        green * alpha,
        blue * alpha,
        alpha
      );
    }

    const MTLRegion region = MTLRegionMake2D(
      0,
      0,
      static_cast<NSUInteger>(asset.width),
      static_cast<NSUInteger>(asset.height)
    );
    [textureState.texture replaceRegion:region
                            mipmapLevel:0
                              withBytes:rgbaPixels.data()
                            bytesPerRow:static_cast<NSUInteger>(asset.width * sizeof(simd_float4))];
    textureState.version = asset.version;
  }

  *outTexture = textureState.texture;
  if (outScratchTexture) {
    *outScratchTexture = textureState.scratchTexture;
  }
  if (outNeedsUpdate) {
    *outNeedsUpdate = needsUpload;
  }
  return true;
}

void MarkImageTextureVersion(
  std::uint64_t cacheKey,
  int imageId,
  std::uint64_t version
) {
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  auto cacheIt = gMetalImageTextures.find(cacheKey);
  if (cacheIt == gMetalImageTextures.end()) {
    return;
  }
  auto imageIt = cacheIt->second.find(imageId);
  if (imageIt == cacheIt->second.end()) {
    return;
  }
  imageIt->second.version = version;
}

void UpdateAccumulationCache(std::uint64_t cacheKey, const MetalCanvasState& cache) {
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  gMetalPlaybackCanvasStates[cacheKey] = cache;
}

void UpdateRecoveryCache(std::uint64_t cacheKey, const MetalCanvasState& cache) {
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  gMetalRecoveryCanvasStates[cacheKey] = cache;
}

constexpr std::size_t kMaxMetalCanvasCheckpoints = 32;
constexpr std::size_t kMaxMetalExactFrameTextures = 16;

PF_Err EncodeCopyTextureRaw(
  id<MTLCommandBuffer> commandBuffer,
  const MetalRendererState& state,
  A_long width,
  A_long height,
  id<MTLTexture> sourceTexture,
  id<MTLTexture> destinationTexture,
  std::string* errorMessage
) {
  if (!commandBuffer || !sourceTexture || !destinationTexture) {
    if (errorMessage) {
      *errorMessage = "Texture copy pass is missing source or destination texture.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  if (sourceTexture == destinationTexture) {
    return PF_Err_NONE;
  }
  id<MTLComputeCommandEncoder> encoder = [commandBuffer computeCommandEncoder];
  if (!encoder) {
    if (errorMessage) {
      *errorMessage = "Failed to create Metal compute encoder for texture copy.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  const CopyUniforms uniforms{
    static_cast<std::uint32_t>(std::max<A_long>(0, width)),
    static_cast<std::uint32_t>(std::max<A_long>(0, height)),
    0U,
    0U,
    0U,
    0U,
    static_cast<std::uint32_t>(std::max<A_long>(0, width)),
    static_cast<std::uint32_t>(std::max<A_long>(0, height))
  };
  [encoder setComputePipelineState:state.textureCopyPipeline];
  [encoder setTexture:sourceTexture atIndex:0];
  [encoder setTexture:destinationTexture atIndex:1];
  [encoder setBytes:&uniforms length:sizeof(uniforms) atIndex:0];
  const MTLSize threadsPerGroup = MTLSizeMake(8, 8, 1);
  const MTLSize threadgroups = MTLSizeMake(
    (uniforms.width + threadsPerGroup.width - 1) / threadsPerGroup.width,
    (uniforms.height + threadsPerGroup.height - 1) / threadsPerGroup.height,
    1
  );
  [encoder dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
  [encoder endEncoding];
  return PF_Err_NONE;
}

std::optional<MetalCanvasCheckpoint> GetMetalCanvasCheckpoint(
  std::uint64_t cacheKey,
  long frame
) {
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  const auto checkpointIt = gMetalCanvasCheckpoints.find(cacheKey);
  if (checkpointIt == gMetalCanvasCheckpoints.end()) {
    return std::nullopt;
  }
  for (const auto& checkpoint : checkpointIt->second) {
    if (checkpoint.frame == frame && checkpoint.texture) {
      MetalCanvasCheckpoint copy = checkpoint;
      [copy.texture retain];
      return copy;
    }
  }
  return std::nullopt;
}

std::optional<MetalExactFrameTexture> GetMetalExactFrameTexture(
  std::uint64_t cacheKey,
  long frame
) {
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  const auto frameIt = gMetalExactFrameTextures.find(cacheKey);
  if (frameIt == gMetalExactFrameTextures.end()) {
    return std::nullopt;
  }
  for (const auto& frameTexture : frameIt->second) {
    if (frameTexture.frame == frame && frameTexture.texture) {
      MetalExactFrameTexture copy = frameTexture;
      [copy.texture retain];
      return copy;
    }
  }
  return std::nullopt;
}

void StoreMetalCanvasCheckpoint(
  std::uint64_t cacheKey,
  long frame,
  A_long width,
  A_long height,
  id<MTLTexture> texture
) {
  if (cacheKey == 0 || frame < 0 || !texture) {
    return;
  }

  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  auto& checkpoints = gMetalCanvasCheckpoints[cacheKey];
  auto existing = std::find_if(
    checkpoints.begin(),
    checkpoints.end(),
    [frame](const MetalCanvasCheckpoint& checkpoint) { return checkpoint.frame == frame; }
  );
  if (existing != checkpoints.end()) {
    ReleaseMetalCanvasCheckpoint(&(*existing));
    checkpoints.erase(existing);
  }

  MetalCanvasCheckpoint checkpoint;
  checkpoint.frame = frame;
  checkpoint.width = width;
  checkpoint.height = height;
  checkpoint.texture = texture;
  checkpoints.push_back(checkpoint);
  std::sort(
    checkpoints.begin(),
    checkpoints.end(),
    [](const MetalCanvasCheckpoint& lhs, const MetalCanvasCheckpoint& rhs) {
      return lhs.frame < rhs.frame;
    }
  );
  while (checkpoints.size() > kMaxMetalCanvasCheckpoints) {
    ReleaseMetalCanvasCheckpoint(&checkpoints.front());
    checkpoints.erase(checkpoints.begin());
  }
}

void StoreMetalExactFrameTexture(
  std::uint64_t cacheKey,
  long frame,
  A_long width,
  A_long height,
  id<MTLTexture> texture
) {
  if (cacheKey == 0 || frame < 0 || !texture) {
    return;
  }

  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  auto& frames = gMetalExactFrameTextures[cacheKey];
  auto existing = std::find_if(
    frames.begin(),
    frames.end(),
    [frame](const MetalExactFrameTexture& frameTexture) { return frameTexture.frame == frame; }
  );
  if (existing != frames.end()) {
    ReleaseMetalExactFrameTexture(&(*existing));
    frames.erase(existing);
  }

  MetalExactFrameTexture frameTexture;
  frameTexture.frame = frame;
  frameTexture.width = width;
  frameTexture.height = height;
  frameTexture.texture = texture;
  frames.push_back(frameTexture);
  std::sort(
    frames.begin(),
    frames.end(),
    [](const MetalExactFrameTexture& lhs, const MetalExactFrameTexture& rhs) {
      return lhs.frame < rhs.frame;
    }
  );
  while (frames.size() > kMaxMetalExactFrameTextures) {
    ReleaseMetalExactFrameTexture(&frames.front());
    frames.erase(frames.begin());
  }
}

bool QueryMetalBitmapNearestCheckpointInternal(
  std::uint64_t cacheKey,
  long targetFrame,
  long* outCheckpointFrame
) {
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  const auto checkpointIt = gMetalCanvasCheckpoints.find(cacheKey);
  if (checkpointIt == gMetalCanvasCheckpoints.end()) {
    if (outCheckpointFrame) {
      *outCheckpointFrame = 0;
    }
    return false;
  }

  long bestFrame = -1;
  for (const auto& checkpoint : checkpointIt->second) {
    if (!checkpoint.texture || checkpoint.frame > targetFrame) {
      continue;
    }
    if (bestFrame < 0 || checkpoint.frame > bestFrame) {
      bestFrame = checkpoint.frame;
    }
  }
  if (outCheckpointFrame) {
    *outCheckpointFrame = bestFrame >= 0 ? bestFrame : 0;
  }
  return bestFrame >= 0;
}

PF_Err EncodeCopyTextureToOutput(
  id<MTLCommandBuffer> commandBuffer,
  const MetalRendererState& state,
  id<MTLTexture> sourceTexture,
  const BitmapGpuRenderTarget& target,
  std::string* errorMessage
) {
  if (!commandBuffer || !sourceTexture || !target.outputWorldData) {
    if (errorMessage) {
      *errorMessage = "Metal output copy request is missing required resources.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  id<MTLComputeCommandEncoder> encoder = [commandBuffer computeCommandEncoder];
  if (!encoder) {
    if (errorMessage) {
      *errorMessage = "Failed to create Metal compute encoder for output copy.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const CopyUniforms uniforms{
    static_cast<std::uint32_t>(std::max<A_long>(0, target.outputWorld->width)),
    static_cast<std::uint32_t>(std::max<A_long>(0, target.outputWorld->height)),
    static_cast<std::uint32_t>(target.outputWorld->rowbytes / sizeof(GpuBgra128Pixel)),
    0U,
    static_cast<std::uint32_t>(std::max<A_long>(0, target.sourceOriginX)),
    static_cast<std::uint32_t>(std::max<A_long>(0, target.sourceOriginY)),
    static_cast<std::uint32_t>(std::max<A_long>(0, target.logicalWidth)),
    static_cast<std::uint32_t>(std::max<A_long>(0, target.logicalHeight))
  };

  [encoder setComputePipelineState:state.copyPipeline];
  [encoder setTexture:sourceTexture atIndex:0];
  [encoder setBuffer:(id<MTLBuffer>)target.outputWorldData offset:0 atIndex:0];
  [encoder setBytes:&uniforms length:sizeof(uniforms) atIndex:1];

  const MTLSize threadsPerGroup = MTLSizeMake(8, 8, 1);
  const MTLSize threadgroups = MTLSizeMake(
    (uniforms.width + threadsPerGroup.width - 1) / threadsPerGroup.width,
    (uniforms.height + threadsPerGroup.height - 1) / threadsPerGroup.height,
    1
  );
  [encoder dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
  [encoder endEncoding];
  return PF_Err_NONE;
}

PF_Err RenderDrawPlanToTexture(
  id<MTLCommandBuffer> commandBuffer,
  const MetalRendererState& state,
  id<MTLTexture> targetTexture,
  id<MTLTexture> scratchTexture,
  const GpuRenderPlan& plan,
  std::uint64_t cacheKey,
  bool clearTexture,
  std::unordered_set<int>* imageRenderStack,
  std::string* errorMessage
) {
  if (!commandBuffer || !targetTexture || !scratchTexture) {
    if (errorMessage) {
      *errorMessage = "Metal draw-plan render request is missing a target texture.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const simd_float4 clearColor = ToStraightFloatColor(plan.clearColor);
  std::unordered_set<int> localImageStack;
  if (!imageRenderStack) {
    imageRenderStack = &localImageStack;
  }
  const ViewportUniforms viewport{
    simd_make_float2(
      static_cast<float>(std::max<A_long>(1, plan.width)),
      static_cast<float>(std::max<A_long>(1, plan.height))
    )
  };
  MetalBufferArena analyticTriangleArena{state.device, static_cast<NSUInteger>(512 * 1024)};
  MetalBufferArena analyticEdgeArena{state.device, static_cast<NSUInteger>(256 * 1024)};

  std::vector<simd_float2> pathFillVertices;
  pathFillVertices.reserve(plan.pathFillVertices.size());
  for (std::size_t index = 0; index < plan.pathFillVertices.size(); ++index) {
    const GpuRenderPlan::PathFillVertex& vertex = plan.pathFillVertices[index];
    pathFillVertices.push_back(simd_make_float2(vertex.x, vertex.y));
  }

  std::vector<MetalPathFillContour> pathFillContours;
  pathFillContours.reserve(plan.pathFillContours.size());
  for (std::size_t index = 0; index < plan.pathFillContours.size(); ++index) {
    const GpuRenderPlan::PathFillContour& contour = plan.pathFillContours[index];
    MetalPathFillContour metalContour;
    metalContour.vertexStart = contour.vertexStart;
    metalContour.vertexCount = contour.vertexCount;
    pathFillContours.push_back(metalContour);
  }

  id<MTLBuffer> pathFillVertexBuffer = nil;
  id<MTLBuffer> pathFillContourBuffer = nil;
  struct PathFillBufferGuard {
    id<MTLBuffer>& vertices;
    id<MTLBuffer>& contours;
    ~PathFillBufferGuard() {
      [vertices release];
      [contours release];
    }
  } pathFillBufferGuard{pathFillVertexBuffer, pathFillContourBuffer};
  if (!pathFillVertices.empty()) {
    pathFillVertexBuffer = [state.device newBufferWithBytes:pathFillVertices.data()
                                                     length:pathFillVertices.size() * sizeof(simd_float2)
                                                    options:MTLResourceStorageModeShared];
    if (!pathFillVertexBuffer) {
      if (errorMessage) {
        *errorMessage = "Failed to allocate Metal path-fill vertex buffer.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
  }
  if (!pathFillContours.empty()) {
    pathFillContourBuffer = [state.device newBufferWithBytes:pathFillContours.data()
                                                      length:pathFillContours.size() * sizeof(MetalPathFillContour)
                                                     options:MTLResourceStorageModeShared];
    if (!pathFillContourBuffer) {
      if (errorMessage) {
        *errorMessage = "Failed to allocate Metal path-fill contour buffer.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
  }

  auto resolveImageTextureForAsset = [&](const RuntimeImageAsset& asset) -> id<MTLTexture> {
    id<MTLTexture> imageTexture = nil;
    id<MTLTexture> imageScratchTexture = nil;
    bool needsUpdate = false;
    if (!EnsureImageTexture(
      state.device,
      cacheKey,
      asset,
      &imageTexture,
      &imageScratchTexture,
      &needsUpdate,
      errorMessage
    )) {
      return nil;
    }
    if (!asset.gpuSceneBacked || !asset.gpuScene || !needsUpdate) {
      return imageTexture;
    }

    if (imageRenderStack->find(asset.id) != imageRenderStack->end()) {
      if (errorMessage) {
        *errorMessage = "Detected recursive scene-backed image dependency.";
      }
      return nil;
    }
    if (!imageScratchTexture) {
      if (errorMessage) {
        *errorMessage = "Scene-backed image is missing scratch render texture.";
      }
      return nil;
    }

    imageRenderStack->insert(asset.id);
    PF_LayerDef sceneOutput{};
    sceneOutput.width = asset.width;
    sceneOutput.height = asset.height;
    GpuRenderPlan scenePlan;
    std::string scenePlanError;
    if (!BuildBitmapGpuPlan(
      &sceneOutput,
      cacheKey,
      plan.targetFrame,
      *asset.gpuScene,
      &scenePlan,
      &scenePlanError
    )) {
      imageRenderStack->erase(asset.id);
      if (errorMessage) {
        *errorMessage = scenePlanError.empty()
          ? "Failed to build scene-backed image GPU plan."
          : scenePlanError;
      }
      return nil;
    }

    PF_Err sceneErr = RenderDrawPlanToTexture(
      commandBuffer,
      state,
      imageTexture,
      imageScratchTexture,
      scenePlan,
      cacheKey,
      true,
      imageRenderStack,
      errorMessage
    );
    imageRenderStack->erase(asset.id);
    if (sceneErr != PF_Err_NONE) {
      return nil;
    }

    MarkImageTextureVersion(cacheKey, asset.id, asset.version);
    return imageTexture;
  };

  std::unordered_map<int, id<MTLTexture>> resolvedImageTextures;
  auto resolveImageTextureById = [&](int imageId) -> id<MTLTexture> {
    if (imageId <= 0) {
      return nil;
    }
    const auto cachedTextureIt = resolvedImageTextures.find(imageId);
    if (cachedTextureIt != resolvedImageTextures.end()) {
      return cachedTextureIt->second;
    }
    const auto assetIt = plan.scene.imageAssets.find(imageId);
    if (assetIt == plan.scene.imageAssets.end()) {
      if (errorMessage) {
        *errorMessage = "Image draw references an unknown image asset.";
      }
      return nil;
    }
    id<MTLTexture> texture = resolveImageTextureForAsset(assetIt->second);
    if (!texture) {
      return nil;
    }
    resolvedImageTextures[imageId] = texture;
    return texture;
  };

  auto resolveClipTextureForBatch = [&](const GpuRenderPlan::DrawBatch& batch) -> id<MTLTexture> {
    if (batch.clipImageId == 0) {
      return state.whiteMaskTexture;
    }
    id<MTLTexture> clipTexture = resolveImageTextureById(batch.clipImageId);
    if (!clipTexture) {
      return nil;
    }
    return clipTexture;
  };

  auto encodeClearTarget = [&](id<MTLTexture> textureToClear, const simd_float4& color) -> PF_Err {
    MTLRenderPassDescriptor* clearPass = [MTLRenderPassDescriptor renderPassDescriptor];
    clearPass.colorAttachments[0].texture = textureToClear;
    clearPass.colorAttachments[0].loadAction = MTLLoadActionClear;
    clearPass.colorAttachments[0].storeAction = MTLStoreActionStore;
    clearPass.colorAttachments[0].clearColor = MTLClearColorMake(
      static_cast<double>(color.x * color.w),
      static_cast<double>(color.y * color.w),
      static_cast<double>(color.z * color.w),
      static_cast<double>(color.w)
    );
    id<MTLRenderCommandEncoder> clearEncoder = [commandBuffer renderCommandEncoderWithDescriptor:clearPass];
    if (!clearEncoder) {
      if (errorMessage) {
        *errorMessage = "Failed to create Metal encoder for target clear.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
    [clearEncoder endEncoding];
    return PF_Err_NONE;
  };

  auto encodeBatchDraw = [&](
    id<MTLTexture> destinationTexture,
    bool clearDestination,
    const simd_float4& destinationClearColor,
    const GpuRenderPlan::DrawBatch& batch
  ) -> PF_Err {
    if (batch.type == GpuRenderPlan::DRAW_BATCH_FILLS) {
      if (batch.start + batch.count > plan.fillTriangles.size()) {
        if (errorMessage) {
          *errorMessage = "Metal fill batch references out-of-range fill triangles.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      if (batch.count == 0) {
        return PF_Err_NONE;
      }

      const FillBatchGeometry geometry = BuildTriangleBatchGeometry(plan.fillTriangles, plan.boundaryEdges, batch);
      if (geometry.triangles.empty() || !geometry.hasBounds) {
        return PF_Err_NONE;
      }

      const GpuRenderPlan::FillTriangle& firstTriangle = plan.fillTriangles[batch.start];
      const simd_float4 fillColor = ToStraightFloatColor(firstTriangle.color);
      const int startX = std::max(0, static_cast<int>(std::floor(geometry.bounds.x - 1.0f)));
      const int startY = std::max(0, static_cast<int>(std::floor(geometry.bounds.y - 1.0f)));
      const int endX = std::min(static_cast<int>(plan.width), static_cast<int>(std::ceil(geometry.bounds.z + 1.0f)));
      const int endY = std::min(static_cast<int>(plan.height), static_cast<int>(std::ceil(geometry.bounds.w + 1.0f)));
      const std::uint32_t regionWidth =
        endX > startX ? static_cast<std::uint32_t>(endX - startX) : 0U;
      const std::uint32_t regionHeight =
        endY > startY ? static_cast<std::uint32_t>(endY - startY) : 0U;
      if (regionWidth == 0 || regionHeight == 0) {
        return PF_Err_NONE;
      }

      id<MTLTexture> clipTexture = resolveClipTextureForBatch(batch);
      if (!clipTexture) {
        if (errorMessage && errorMessage->empty()) {
          *errorMessage = "Failed to resolve clip texture for Metal fill batch.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      if (clearDestination) {
        PF_Err clearErr = encodeClearTarget(destinationTexture, destinationClearColor);
        if (clearErr != PF_Err_NONE) {
          return clearErr;
        }
      }

      MetalBufferSlice triangleSlice;
      if (!UploadToMetalBufferArena(
            &analyticTriangleArena,
            geometry.triangles.data(),
            static_cast<NSUInteger>(geometry.triangles.size() * sizeof(MetalFillTriangleData)),
            "analytic-fill triangles",
            &triangleSlice,
            errorMessage)) {
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      MetalBufferSlice edgeSlice;
      if (!geometry.boundaryEdges.empty() &&
          !UploadToMetalBufferArena(
            &analyticEdgeArena,
            geometry.boundaryEdges.data(),
            static_cast<NSUInteger>(geometry.boundaryEdges.size() * sizeof(MetalEdgeSegment)),
            "analytic-fill edges",
            &edgeSlice,
            errorMessage)) {
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }

      const FillRasterUniforms uniforms{
        static_cast<std::uint32_t>(startX),
        static_cast<std::uint32_t>(startY),
        regionWidth,
        regionHeight,
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.width)),
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.height)),
        static_cast<std::uint32_t>(geometry.triangles.size()),
        static_cast<std::uint32_t>(geometry.boundaryEdges.size()),
        batch.hasAnalyticClip ? batch.clipContourStart : 0U,
        batch.hasAnalyticClip ? batch.clipContourCount : 0U,
        simd_make_float2(
          static_cast<float>(std::max<A_long>(1, plan.width)),
          static_cast<float>(std::max<A_long>(1, plan.height))
        ),
        fillColor,
        geometry.bounds,
        simd_make_float4(batch.clipMinX, batch.clipMinY, batch.clipMaxX, batch.clipMaxY)
      };

      id<MTLComputeCommandEncoder> encoder = [commandBuffer computeCommandEncoder];
      if (!encoder) {
        if (errorMessage) {
          *errorMessage = "Failed to create Metal compute encoder for analytic fills.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      [encoder setComputePipelineState:state.fillAnalyticPipeline];
      [encoder setBuffer:triangleSlice.buffer offset:triangleSlice.offset atIndex:0];
      [encoder setBuffer:edgeSlice.buffer offset:edgeSlice.offset atIndex:1];
      [encoder setBytes:&uniforms length:sizeof(uniforms) atIndex:2];
      [encoder setBuffer:pathFillVertexBuffer offset:0 atIndex:3];
      [encoder setBuffer:pathFillContourBuffer offset:0 atIndex:4];
      [encoder setTexture:destinationTexture atIndex:0];
      [encoder setTexture:clipTexture atIndex:1];
      const MTLSize threadsPerGroup = MTLSizeMake(8, 8, 1);
      const MTLSize threadgroups = MTLSizeMake(
        (regionWidth + threadsPerGroup.width - 1) / threadsPerGroup.width,
        (regionHeight + threadsPerGroup.height - 1) / threadsPerGroup.height,
        1
      );
      [encoder dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
      [encoder endEncoding];
      return PF_Err_NONE;
    }

    if (batch.type == GpuRenderPlan::DRAW_BATCH_STROKES) {
      if (batch.start + batch.count > plan.strokeTriangles.size()) {
        if (errorMessage) {
          *errorMessage = "Metal stroke batch references out-of-range stroke triangles.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      if (batch.count == 0) {
        return PF_Err_NONE;
      }

      const FillBatchGeometry geometry =
        BuildTriangleBatchGeometry(plan.strokeTriangles, plan.strokeBoundaryEdges, batch);
      if (geometry.triangles.empty() || !geometry.hasBounds) {
        return PF_Err_NONE;
      }

      const GpuRenderPlan::FillTriangle& firstTriangle = plan.strokeTriangles[batch.start];
      const simd_float4 fillColor = ToStraightFloatColor(firstTriangle.color);
      const int startX = std::max(0, static_cast<int>(std::floor(geometry.bounds.x - 1.0f)));
      const int startY = std::max(0, static_cast<int>(std::floor(geometry.bounds.y - 1.0f)));
      const int endX = std::min(static_cast<int>(plan.width), static_cast<int>(std::ceil(geometry.bounds.z + 1.0f)));
      const int endY = std::min(static_cast<int>(plan.height), static_cast<int>(std::ceil(geometry.bounds.w + 1.0f)));
      const std::uint32_t regionWidth = endX > startX ? static_cast<std::uint32_t>(endX - startX) : 0U;
      const std::uint32_t regionHeight = endY > startY ? static_cast<std::uint32_t>(endY - startY) : 0U;
      if (regionWidth == 0 || regionHeight == 0) {
        return PF_Err_NONE;
      }

      id<MTLTexture> clipTexture = resolveClipTextureForBatch(batch);
      if (!clipTexture) {
        if (errorMessage && errorMessage->empty()) {
          *errorMessage = "Failed to resolve clip texture for Metal stroke batch.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      if (clearDestination) {
        PF_Err clearErr = encodeClearTarget(destinationTexture, destinationClearColor);
        if (clearErr != PF_Err_NONE) {
          return clearErr;
        }
      }

      MetalBufferSlice triangleSlice;
      if (!UploadToMetalBufferArena(
            &analyticTriangleArena,
            geometry.triangles.data(),
            static_cast<NSUInteger>(geometry.triangles.size() * sizeof(MetalFillTriangleData)),
            "analytic-stroke triangles",
            &triangleSlice,
            errorMessage)) {
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      MetalBufferSlice edgeSlice;
      if (!geometry.boundaryEdges.empty() &&
          !UploadToMetalBufferArena(
            &analyticEdgeArena,
            geometry.boundaryEdges.data(),
            static_cast<NSUInteger>(geometry.boundaryEdges.size() * sizeof(MetalEdgeSegment)),
            "analytic-stroke edges",
            &edgeSlice,
            errorMessage)) {
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }

      const FillRasterUniforms uniforms{
        static_cast<std::uint32_t>(startX),
        static_cast<std::uint32_t>(startY),
        regionWidth,
        regionHeight,
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.width)),
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.height)),
        static_cast<std::uint32_t>(geometry.triangles.size()),
        static_cast<std::uint32_t>(geometry.boundaryEdges.size()),
        batch.hasAnalyticClip ? batch.clipContourStart : 0U,
        batch.hasAnalyticClip ? batch.clipContourCount : 0U,
        simd_make_float2(
          static_cast<float>(std::max<A_long>(1, plan.width)),
          static_cast<float>(std::max<A_long>(1, plan.height))
        ),
        fillColor,
        geometry.bounds,
        simd_make_float4(batch.clipMinX, batch.clipMinY, batch.clipMaxX, batch.clipMaxY)
      };

      id<MTLComputeCommandEncoder> encoder = [commandBuffer computeCommandEncoder];
      if (!encoder) {
        if (errorMessage) {
          *errorMessage = "Failed to create Metal compute encoder for analytic strokes.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      [encoder setComputePipelineState:state.fillAnalyticPipeline];
      [encoder setBuffer:triangleSlice.buffer offset:triangleSlice.offset atIndex:0];
      [encoder setBuffer:edgeSlice.buffer offset:edgeSlice.offset atIndex:1];
      [encoder setBytes:&uniforms length:sizeof(uniforms) atIndex:2];
      [encoder setBuffer:pathFillVertexBuffer offset:0 atIndex:3];
      [encoder setBuffer:pathFillContourBuffer offset:0 atIndex:4];
      [encoder setTexture:destinationTexture atIndex:0];
      [encoder setTexture:clipTexture atIndex:1];
      const MTLSize threadsPerGroup = MTLSizeMake(8, 8, 1);
      const MTLSize threadgroups = MTLSizeMake(
        (regionWidth + threadsPerGroup.width - 1) / threadsPerGroup.width,
        (regionHeight + threadsPerGroup.height - 1) / threadsPerGroup.height,
        1
      );
      [encoder dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
      [encoder endEncoding];
      return PF_Err_NONE;
    }

    if (batch.type == GpuRenderPlan::DRAW_BATCH_PATH_FILLS) {
      if (batch.start + batch.count > plan.pathFills.size()) {
        if (errorMessage) {
          *errorMessage = "Metal path-fill batch references out-of-range path fill entries.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      if (batch.count == 0) {
        return PF_Err_NONE;
      }
      if (!pathFillVertexBuffer || !pathFillContourBuffer) {
        if (errorMessage) {
          *errorMessage = "Metal path-fill batch is missing GPU contour buffers.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      if (clearDestination) {
        PF_Err clearErr = encodeClearTarget(destinationTexture, destinationClearColor);
        if (clearErr != PF_Err_NONE) {
          return clearErr;
        }
      }

      id<MTLComputeCommandEncoder> encoder = [commandBuffer computeCommandEncoder];
      if (!encoder) {
        if (errorMessage) {
          *errorMessage = "Failed to create Metal compute encoder for path fills.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }

      [encoder setComputePipelineState:state.pathFillPipeline];
      [encoder setBuffer:pathFillVertexBuffer offset:0 atIndex:0];
      [encoder setBuffer:pathFillContourBuffer offset:0 atIndex:1];
      [encoder setTexture:destinationTexture atIndex:0];

      const MTLSize threadsPerGroup = MTLSizeMake(8, 8, 1);
      const std::uint32_t canvasWidth = static_cast<std::uint32_t>(std::max<A_long>(0, plan.width));
      const std::uint32_t canvasHeight = static_cast<std::uint32_t>(std::max<A_long>(0, plan.height));
      for (std::size_t index = 0; index < batch.count; ++index) {
        const GpuRenderPlan::PathFill& pathFill = plan.pathFills[batch.start + index];
        if (pathFill.contourCount == 0) {
          continue;
        }

        const int startX = std::max(0, static_cast<int>(std::floor(pathFill.minX - 1.0f)));
        const int startY = std::max(0, static_cast<int>(std::floor(pathFill.minY - 1.0f)));
        const int endX = std::min(static_cast<int>(plan.width), static_cast<int>(std::ceil(pathFill.maxX + 1.0f)));
        const int endY = std::min(static_cast<int>(plan.height), static_cast<int>(std::ceil(pathFill.maxY + 1.0f)));
        const std::uint32_t regionWidth =
          endX > startX ? static_cast<std::uint32_t>(endX - startX) : 0U;
        const std::uint32_t regionHeight =
          endY > startY ? static_cast<std::uint32_t>(endY - startY) : 0U;
        if (regionWidth == 0 || regionHeight == 0) {
          continue;
        }

        id<MTLTexture> clipTexture = resolveClipTextureForBatch(batch);
        if (!clipTexture) {
          if (errorMessage && errorMessage->empty()) {
            *errorMessage = "Failed to resolve clip texture for Metal path-fill batch.";
          }
          [encoder endEncoding];
          return PF_Err_INTERNAL_STRUCT_DAMAGED;
        }
        [encoder setTexture:clipTexture atIndex:1];

        const PathFillUniforms uniforms{
          static_cast<std::uint32_t>(startX),
          static_cast<std::uint32_t>(startY),
          regionWidth,
          regionHeight,
          canvasWidth,
          canvasHeight,
          pathFill.contourStart,
          pathFill.contourCount,
          batch.hasAnalyticClip ? batch.clipContourStart : 0U,
          batch.hasAnalyticClip ? batch.clipContourCount : 0U,
          simd_make_float2(
            static_cast<float>(std::max<A_long>(1, plan.width)),
            static_cast<float>(std::max<A_long>(1, plan.height))
          ),
          ToStraightFloatColor(pathFill.color),
          simd_make_float4(pathFill.minX, pathFill.minY, pathFill.maxX, pathFill.maxY),
          simd_make_float4(batch.clipMinX, batch.clipMinY, batch.clipMaxX, batch.clipMaxY)
        };
        [encoder setBytes:&uniforms length:sizeof(uniforms) atIndex:2];
        const MTLSize threadgroups = MTLSizeMake(
          (regionWidth + threadsPerGroup.width - 1) / threadsPerGroup.width,
          (regionHeight + threadsPerGroup.height - 1) / threadsPerGroup.height,
          1
        );
        [encoder dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
      }

      [encoder endEncoding];
      return PF_Err_NONE;
    }

    MTLRenderPassDescriptor* pass = [MTLRenderPassDescriptor renderPassDescriptor];
    pass.colorAttachments[0].texture = destinationTexture;
    pass.colorAttachments[0].loadAction = clearDestination ? MTLLoadActionClear : MTLLoadActionLoad;
    pass.colorAttachments[0].storeAction = MTLStoreActionStore;
    pass.colorAttachments[0].clearColor = MTLClearColorMake(
      static_cast<double>(destinationClearColor.x * destinationClearColor.w),
      static_cast<double>(destinationClearColor.y * destinationClearColor.w),
      static_cast<double>(destinationClearColor.z * destinationClearColor.w),
      static_cast<double>(destinationClearColor.w)
    );

    id<MTLRenderCommandEncoder> encoder = [commandBuffer renderCommandEncoderWithDescriptor:pass];
    if (!encoder) {
      if (errorMessage) {
        *errorMessage = "Failed to create Metal render encoder for batch draw.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }

    id<MTLTexture> clipTexture = resolveClipTextureForBatch(batch);
    if (!clipTexture) {
      if (errorMessage && errorMessage->empty()) {
        *errorMessage = "Failed to resolve clip texture for Metal draw batch.";
      }
      [encoder endEncoding];
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }

    if (batch.type == GpuRenderPlan::DRAW_BATCH_IMAGES ||
        batch.type == GpuRenderPlan::DRAW_BATCH_TEXT_IMAGES) {
      if (batch.start + batch.count > plan.imageDraws.size()) {
        [encoder endEncoding];
        if (errorMessage) {
          *errorMessage = "Metal image batch references out-of-range image draw entries.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      [encoder setRenderPipelineState:
        batch.type == GpuRenderPlan::DRAW_BATCH_TEXT_IMAGES
          ? state.textImagePipeline
          : state.imagePipeline];
      [encoder setVertexBytes:&viewport length:sizeof(viewport) atIndex:1];
      [encoder setFragmentBytes:&viewport length:sizeof(viewport) atIndex:0];
      [encoder setFragmentTexture:clipTexture atIndex:1];

      for (std::size_t i = 0; i < batch.count; ++i) {
        const GpuRenderPlan::ImageDraw& draw = plan.imageDraws[batch.start + i];
        id<MTLTexture> imageTexture = resolveImageTextureById(draw.imageId);
        if (!imageTexture) {
          if (errorMessage && errorMessage->empty()) {
            *errorMessage = "Failed to resolve image texture for Metal image batch.";
          }
          [encoder endEncoding];
          return PF_Err_INTERNAL_STRUCT_DAMAGED;
        }

        const simd_float4 tint = ToStraightFloatColor(draw.tint);
        const MetalImageVertex vertices[6] = {
          {simd_make_float2(draw.x1, draw.y1), simd_make_float2(draw.u1, draw.v1), tint},
          {simd_make_float2(draw.x2, draw.y2), simd_make_float2(draw.u2, draw.v2), tint},
          {simd_make_float2(draw.x3, draw.y3), simd_make_float2(draw.u3, draw.v3), tint},
          {simd_make_float2(draw.x1, draw.y1), simd_make_float2(draw.u1, draw.v1), tint},
          {simd_make_float2(draw.x3, draw.y3), simd_make_float2(draw.u3, draw.v3), tint},
          {simd_make_float2(draw.x4, draw.y4), simd_make_float2(draw.u4, draw.v4), tint},
        };
        [encoder setVertexBytes:vertices length:sizeof(vertices) atIndex:0];
        [encoder setFragmentTexture:imageTexture atIndex:0];
        [encoder drawPrimitives:MTLPrimitiveTypeTriangle
                    vertexStart:0
                    vertexCount:6];
      }
    } else {
      [encoder endEncoding];
      if (errorMessage) {
        *errorMessage = "Metal draw plan contains an unknown batch type.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }

    [encoder endEncoding];
    return PF_Err_NONE;
  };

  auto encodeCompositeScratchIntoTarget = [&](const GpuRenderPlan::DrawBatch& batch) -> PF_Err {
    id<MTLComputeCommandEncoder> encoder = [commandBuffer computeCommandEncoder];
    if (!encoder) {
      if (errorMessage) {
        *errorMessage = "Failed to create Metal compute encoder for batch compositing.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
    const BlendUniforms uniforms{
      static_cast<std::uint32_t>(std::max<A_long>(0, plan.width)),
      static_cast<std::uint32_t>(std::max<A_long>(0, plan.height)),
      static_cast<std::int32_t>(batch.blendMode),
      batch.erase ? 1U : 0U,
      std::max(0.0f, batch.eraseStrength)
    };
    [encoder setComputePipelineState:state.compositePipeline];
    [encoder setTexture:scratchTexture atIndex:0];
    [encoder setTexture:targetTexture atIndex:1];
    [encoder setBytes:&uniforms length:sizeof(uniforms) atIndex:0];
    const MTLSize threadsPerGroup = MTLSizeMake(8, 8, 1);
    const MTLSize threadgroups = MTLSizeMake(
      (uniforms.width + threadsPerGroup.width - 1) / threadsPerGroup.width,
      (uniforms.height + threadsPerGroup.height - 1) / threadsPerGroup.height,
      1
    );
    [encoder dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
    [encoder endEncoding];
    return PF_Err_NONE;
  };

  auto encodeCopyTextureRaw = [&](
    id<MTLTexture> sourceTexture,
    id<MTLTexture> destinationTexture
  ) -> PF_Err {
    return EncodeCopyTextureRaw(
      commandBuffer,
      state,
      plan.width,
      plan.height,
      sourceTexture,
      destinationTexture,
      errorMessage
    );
  };

  auto encodeFilterBatch = [&](const GpuRenderPlan::DrawBatch& batch) -> PF_Err {
    if (batch.start + batch.count > plan.filterPasses.size()) {
      if (errorMessage) {
        *errorMessage = "Metal filter batch references out-of-range filter passes.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
    if (batch.count == 0) {
      return PF_Err_NONE;
    }

    id<MTLTexture> sourceTexture = targetTexture;
    id<MTLTexture> destinationTexture = scratchTexture;
    bool wroteToScratch = false;
    for (std::size_t index = 0; index < batch.count; ++index) {
      const GpuRenderPlan::FilterPass& pass = plan.filterPasses[batch.start + index];
      id<MTLComputeCommandEncoder> encoder = [commandBuffer computeCommandEncoder];
      if (!encoder) {
        if (errorMessage) {
          *errorMessage = "Failed to create Metal compute encoder for filter pass.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      const FilterUniforms uniforms{
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.width)),
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.height)),
        static_cast<std::int32_t>(pass.filterKind),
        pass.value
      };
      [encoder setComputePipelineState:state.filterPipeline];
      [encoder setTexture:sourceTexture atIndex:0];
      [encoder setTexture:destinationTexture atIndex:1];
      [encoder setBytes:&uniforms length:sizeof(uniforms) atIndex:0];
      const MTLSize threadsPerGroup = MTLSizeMake(8, 8, 1);
      const MTLSize threadgroups = MTLSizeMake(
        (uniforms.width + threadsPerGroup.width - 1) / threadsPerGroup.width,
        (uniforms.height + threadsPerGroup.height - 1) / threadsPerGroup.height,
        1
      );
      [encoder dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
      [encoder endEncoding];

      id<MTLTexture> swap = sourceTexture;
      sourceTexture = destinationTexture;
      destinationTexture = swap;
      wroteToScratch = sourceTexture == scratchTexture;
    }

    if (wroteToScratch) {
      return encodeCopyTextureRaw(scratchTexture, targetTexture);
    }
    return PF_Err_NONE;
  };

  auto encodeMaskBatch = [&](const GpuRenderPlan::DrawBatch& batch) -> PF_Err {
    if (batch.start + batch.count > plan.maskPasses.size()) {
      if (errorMessage) {
        *errorMessage = "Metal mask batch references out-of-range mask passes.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
    if (batch.count == 0) {
      return PF_Err_NONE;
    }

    for (std::size_t index = 0; index < batch.count; ++index) {
      const GpuRenderPlan::MaskPass& pass = plan.maskPasses[batch.start + index];
      id<MTLTexture> maskTexture = resolveImageTextureById(pass.maskImageId);
      if (!maskTexture) {
        if (errorMessage && errorMessage->empty()) {
          *errorMessage = "Failed to resolve mask texture for Metal mask batch.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }

      id<MTLComputeCommandEncoder> encoder = [commandBuffer computeCommandEncoder];
      if (!encoder) {
        if (errorMessage) {
          *errorMessage = "Failed to create Metal compute encoder for mask pass.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      const CopyUniforms uniforms{
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.width)),
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.height)),
        0U,
        0U,
        0U,
        0U,
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.width)),
        static_cast<std::uint32_t>(std::max<A_long>(0, plan.height))
      };
      [encoder setComputePipelineState:state.maskPipeline];
      [encoder setTexture:targetTexture atIndex:0];
      [encoder setTexture:maskTexture atIndex:1];
      [encoder setTexture:scratchTexture atIndex:2];
      [encoder setBytes:&uniforms length:sizeof(uniforms) atIndex:0];
      const MTLSize threadsPerGroup = MTLSizeMake(8, 8, 1);
      const MTLSize threadgroups = MTLSizeMake(
        (uniforms.width + threadsPerGroup.width - 1) / threadsPerGroup.width,
        (uniforms.height + threadsPerGroup.height - 1) / threadsPerGroup.height,
        1
      );
      [encoder dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
      [encoder endEncoding];

      PF_Err copyErr = encodeCopyTextureRaw(scratchTexture, targetTexture);
      if (copyErr != PF_Err_NONE) {
        return copyErr;
      }
    }
    return PF_Err_NONE;
  };

  std::vector<GpuRenderPlan::DrawBatch> drawBatches = plan.drawBatches;
  if (drawBatches.empty()) {
    if (!plan.fillTriangles.empty()) {
      GpuRenderPlan::DrawBatch batch;
      batch.type = GpuRenderPlan::DRAW_BATCH_FILLS;
      batch.start = 0;
      batch.count = plan.fillTriangles.size();
      drawBatches.push_back(batch);
    }
    if (!plan.strokeTriangles.empty()) {
      GpuRenderPlan::DrawBatch batch;
      batch.type = GpuRenderPlan::DRAW_BATCH_STROKES;
      batch.start = 0;
      batch.count = plan.strokeTriangles.size();
      batch.explicitEdgeStart = 0;
      batch.explicitEdgeCount = plan.strokeBoundaryEdges.size();
      drawBatches.push_back(batch);
    }
    if (!plan.imageDraws.empty()) {
      GpuRenderPlan::DrawBatch batch;
      batch.type = GpuRenderPlan::DRAW_BATCH_IMAGES;
      batch.start = 0;
      batch.count = plan.imageDraws.size();
      drawBatches.push_back(batch);
    }
    if (!plan.pathFills.empty()) {
      GpuRenderPlan::DrawBatch batch;
      batch.type = GpuRenderPlan::DRAW_BATCH_PATH_FILLS;
      batch.start = 0;
      batch.count = plan.pathFills.size();
      drawBatches.push_back(batch);
    }
    if (!plan.filterPasses.empty()) {
      GpuRenderPlan::DrawBatch batch;
      batch.type = GpuRenderPlan::DRAW_BATCH_FILTERS;
      batch.start = 0;
      batch.count = plan.filterPasses.size();
      drawBatches.push_back(batch);
    }
    if (!plan.maskPasses.empty()) {
      GpuRenderPlan::DrawBatch batch;
      batch.type = GpuRenderPlan::DRAW_BATCH_MASKS;
      batch.start = 0;
      batch.count = plan.maskPasses.size();
      drawBatches.push_back(batch);
    }
  }

  for (std::size_t batchIndex = 0; batchIndex < drawBatches.size(); ++batchIndex) {
    const GpuRenderPlan::DrawBatch& batch = drawBatches[batchIndex];
    if (batch.clipImageId != 0) {
      if (!resolveImageTextureById(batch.clipImageId)) {
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
    }
    if (batch.type == GpuRenderPlan::DRAW_BATCH_IMAGES ||
        batch.type == GpuRenderPlan::DRAW_BATCH_TEXT_IMAGES) {
      if (batch.start + batch.count > plan.imageDraws.size()) {
        if (errorMessage) {
          *errorMessage = "Metal image batch references out-of-range image draw entries.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      for (std::size_t index = 0; index < batch.count; ++index) {
        const GpuRenderPlan::ImageDraw& draw = plan.imageDraws[batch.start + index];
        if (draw.imageId > 0 && !resolveImageTextureById(draw.imageId)) {
          return PF_Err_INTERNAL_STRUCT_DAMAGED;
        }
      }
      continue;
    }
    if (batch.type == GpuRenderPlan::DRAW_BATCH_MASKS) {
      if (batch.start + batch.count > plan.maskPasses.size()) {
        if (errorMessage) {
          *errorMessage = "Metal mask batch references out-of-range mask passes.";
        }
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
      }
      for (std::size_t index = 0; index < batch.count; ++index) {
        const GpuRenderPlan::MaskPass& pass = plan.maskPasses[batch.start + index];
        if (pass.maskImageId > 0 && !resolveImageTextureById(pass.maskImageId)) {
          return PF_Err_INTERNAL_STRUCT_DAMAGED;
        }
      }
      continue;
    }
  }

  bool targetCleared = !clearTexture;
  PF_Err drawErr = PF_Err_NONE;
  for (std::size_t batchIndex = 0; batchIndex < drawBatches.size(); ++batchIndex) {
    const GpuRenderPlan::DrawBatch& batch = drawBatches[batchIndex];
    if (batch.type == GpuRenderPlan::DRAW_BATCH_FILTERS) {
      if (!targetCleared) {
        drawErr = encodeClearTarget(targetTexture, clearColor);
        if (drawErr != PF_Err_NONE) {
          return drawErr;
        }
        targetCleared = true;
      }
      drawErr = encodeFilterBatch(batch);
      if (drawErr != PF_Err_NONE) {
        return drawErr;
      }
      continue;
    }
    if (batch.type == GpuRenderPlan::DRAW_BATCH_MASKS) {
      if (!targetCleared) {
        drawErr = encodeClearTarget(targetTexture, clearColor);
        if (drawErr != PF_Err_NONE) {
          return drawErr;
        }
        targetCleared = true;
      }
      drawErr = encodeMaskBatch(batch);
      if (drawErr != PF_Err_NONE) {
        return drawErr;
      }
      continue;
    }

    const bool needsComposite = batch.erase || batch.blendMode != BLEND_MODE_BLEND;

    if (!targetCleared && needsComposite) {
      drawErr = encodeClearTarget(targetTexture, clearColor);
      if (drawErr != PF_Err_NONE) {
        return drawErr;
      }
      targetCleared = true;
    }

    if (needsComposite) {
      drawErr = encodeBatchDraw(scratchTexture, true, simd_make_float4(0.0f, 0.0f, 0.0f, 0.0f), batch);
      if (drawErr != PF_Err_NONE) {
        return drawErr;
      }
      drawErr = encodeCompositeScratchIntoTarget(batch);
      if (drawErr != PF_Err_NONE) {
        return drawErr;
      }
      continue;
    }

    drawErr = encodeBatchDraw(targetTexture, !targetCleared, clearColor, batch);
    if (drawErr != PF_Err_NONE) {
      return drawErr;
    }
    targetCleared = true;
  }

  if (!targetCleared && clearTexture) {
    drawErr = encodeClearTarget(targetTexture, clearColor);
    if (drawErr != PF_Err_NONE) {
      return drawErr;
    }
  }

  return PF_Err_NONE;
}

bool IsDrawPlanEmpty(const GpuRenderPlan& plan) {
  return
    !plan.clearsSurface &&
    plan.fillTriangles.empty() &&
    plan.strokeTriangles.empty() &&
    plan.pathFills.empty() &&
    plan.imageDraws.empty() &&
    plan.filterPasses.empty() &&
    plan.maskPasses.empty();
}

PF_Err CommitAndWait(id<MTLCommandBuffer> commandBuffer, std::string* errorMessage) {
  if (!commandBuffer) {
    if (errorMessage) {
      *errorMessage = "Metal command buffer is unavailable.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  [commandBuffer commit];
  [commandBuffer waitUntilCompleted];
  if ([commandBuffer status] == MTLCommandBufferStatusError) {
    if (errorMessage) {
      NSError* metalError = [commandBuffer error];
      *errorMessage = metalError ? [[metalError localizedDescription] UTF8String] : "Metal command buffer execution failed.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  return PF_Err_NONE;
}

}  // namespace

void DisposeAllMetalBitmapGpuState(const char* reason) {
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  for (auto& cacheEntry : gMetalImageTextures) {
    for (auto& imageEntry : cacheEntry.second) {
      ReleaseMetalImageTextureState(&imageEntry.second);
    }
  }
  gMetalImageTextures.clear();
  for (auto& entry : gMetalPlaybackCanvasStates) {
    ReleaseMetalCanvasState(&entry.second);
  }
  gMetalPlaybackCanvasStates.clear();
  for (auto& entry : gMetalRecoveryCanvasStates) {
    ReleaseMetalCanvasState(&entry.second);
  }
  gMetalRecoveryCanvasStates.clear();
  for (auto& entry : gMetalCanvasCheckpoints) {
    for (auto& checkpoint : entry.second) {
      ReleaseMetalCanvasCheckpoint(&checkpoint);
    }
  }
  gMetalCanvasCheckpoints.clear();
  for (auto& entry : gMetalExactFrameTextures) {
    for (auto& frameTexture : entry.second) {
      ReleaseMetalExactFrameTexture(&frameTexture);
    }
  }
  gMetalExactFrameTextures.clear();
  gMetalCacheRenderLocks.clear();
  for (auto& entry : gMetalRendererStates) {
    ReleaseMetalRendererState(&entry.second);
  }
  gMetalRendererStates.clear();
}

void DisposeMetalBitmapGpuStateByCacheKey(std::uint64_t cacheKey, const char* reason) {
  if (cacheKey == 0) {
    return;
  }
  std::shared_ptr<std::mutex> cacheRenderLock = GetOrCreateMetalCacheRenderLock(cacheKey);
  std::unique_lock<std::mutex> renderLock;
  if (cacheRenderLock) {
    renderLock = std::unique_lock<std::mutex>(*cacheRenderLock);
  }
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  DisposeMetalBitmapStateByCacheKeyUnlocked(cacheKey);
}

bool QueryMetalBitmapCanvasCursor(
  std::uint64_t cacheKey,
  long* outLastFrame,
  bool* outInitialized
) {
  std::lock_guard<std::mutex> lock(gMetalRendererMutex);
  const auto it = gMetalPlaybackCanvasStates.find(cacheKey);
  if (it == gMetalPlaybackCanvasStates.end()) {
    if (outLastFrame) {
      *outLastFrame = 0;
    }
    if (outInitialized) {
      *outInitialized = false;
    }
    return false;
  }

  if (outLastFrame) {
    *outLastFrame = it->second.lastFrame;
  }
  if (outInitialized) {
    *outInitialized = it->second.initialized;
  }
  return true;
}

bool QueryMetalBitmapNearestCheckpoint(
  std::uint64_t cacheKey,
  long targetFrame,
  long* outCheckpointFrame
) {
  return QueryMetalBitmapNearestCheckpointInternal(cacheKey, targetFrame, outCheckpointFrame);
}

PF_Err RenderBitmapPlanWithMetal(
  const BitmapGpuRenderTarget& target,
  const BitmapFramePlan& plan,
  std::string* errorMessage
) {
  if (!target.outputWorld || !target.outputWorldData) {
    if (errorMessage) {
      *errorMessage = "Metal bitmap render target is invalid.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  if (target.pixelFormat != PF_PixelFormat_GPU_BGRA128) {
    if (errorMessage) {
      *errorMessage = "Metal bitmap backend currently expects PF_PixelFormat_GPU_BGRA128 output.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  if (!plan.supported) {
    if (errorMessage) {
      *errorMessage = !plan.unsupportedReason.empty()
        ? plan.unsupportedReason
        : "GPU bitmap v2 does not support this sketch.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::shared_ptr<std::mutex> cacheRenderLock = GetOrCreateMetalCacheRenderLock(plan.cacheKey);
  std::unique_lock<std::mutex> renderLock;
  if (cacheRenderLock) {
    renderLock = std::unique_lock<std::mutex>(*cacheRenderLock);
  }

  ScopedAutoreleasePool pool;

  id<MTLDevice> device = (id<MTLDevice>)target.deviceInfo.devicePV;
  id<MTLCommandQueue> commandQueue = (id<MTLCommandQueue>)target.deviceInfo.command_queuePV;
  if (!device || !commandQueue) {
    if (errorMessage) {
      *errorMessage = "AE did not provide a valid Metal device and command queue.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  MetalRendererState rendererState;
  if (!EnsureMetalRendererState(device, &rendererState, errorMessage)) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const auto exactFrameTexture = GetMetalExactFrameTexture(plan.cacheKey, plan.targetFrame);
  if (exactFrameTexture.has_value() &&
      exactFrameTexture->texture &&
      exactFrameTexture->width == plan.width &&
      exactFrameTexture->height == plan.height) {
    id<MTLCommandBuffer> exactFrameCommandBuffer = [commandQueue commandBuffer];
    if (!exactFrameCommandBuffer) {
      [exactFrameTexture->texture release];
      if (errorMessage) {
        *errorMessage = "Failed to allocate a Metal command buffer for exact-frame output reuse.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
    PF_Err exactErr = EncodeCopyTextureToOutput(
      exactFrameCommandBuffer,
      rendererState,
      exactFrameTexture->texture,
      target,
      errorMessage
    );
    [exactFrameTexture->texture release];
    if (exactErr != PF_Err_NONE) {
      return exactErr;
    }
    exactErr = CommitAndWait(exactFrameCommandBuffer, errorMessage);
    return exactErr;
  }

  long playbackCanvasLastFrame = 0;
  bool playbackCanvasInitialized = false;
  const bool havePlaybackCanvas =
    QueryMetalBitmapCanvasCursor(plan.cacheKey, &playbackCanvasLastFrame, &playbackCanvasInitialized);
  const bool useRecoveryCanvas =
    plan.profile == BITMAP_GPU_PROFILE_DIRECT_FRAME ||
    plan.hasSeedGpuCheckpoint ||
    (havePlaybackCanvas && playbackCanvasInitialized && plan.targetFrame < playbackCanvasLastFrame);

  MetalCanvasState canvasState;
  if (!EnsureAccumulationTexture(
        device,
        plan.cacheKey,
        plan.width,
        plan.height,
        useRecoveryCanvas,
        &canvasState,
        errorMessage
      )) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const bool replayFromScratch =
    plan.profile == BITMAP_GPU_PROFILE_DIRECT_FRAME ||
    !canvasState.initialized ||
    plan.targetFrame < canvasState.lastFrame;

  id<MTLCommandBuffer> commandBuffer = [commandQueue commandBuffer];
  if (!commandBuffer) {
    if (errorMessage) {
      *errorMessage = "Failed to allocate a Metal command buffer.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  PF_Err err = PF_Err_NONE;
  const bool seededFromGpuCheckpoint = plan.hasSeedGpuCheckpoint && plan.seedFrame >= 0;
  if (seededFromGpuCheckpoint) {
    const auto checkpoint = GetMetalCanvasCheckpoint(plan.cacheKey, plan.seedFrame);
    if (!checkpoint.has_value() || !checkpoint->texture) {
      if (errorMessage) {
        *errorMessage = "GPU canvas checkpoint is missing for the requested seed frame.";
      }
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
    err = EncodeCopyTextureRaw(
      commandBuffer,
      rendererState,
      checkpoint->width,
      checkpoint->height,
      checkpoint->texture,
      canvasState.texture,
      errorMessage
    );
    [checkpoint->texture release];
    if (err != PF_Err_NONE) {
      DisposeMetalBitmapGpuStateByCacheKey(plan.cacheKey, "seed-checkpoint-copy-failed");
      return err;
    }
  }

  long firstOperationFrame = seededFromGpuCheckpoint
    ? (plan.seedFrame + 1)
    : (replayFromScratch ? 0 : (canvasState.lastFrame + 1));
  std::size_t executedOps = 0;
  std::size_t executedFills = 0;
  std::size_t executedStrokes = 0;
  std::size_t executedImages = 0;

  if (!plan.operations.empty()) {
    const BitmapFramePlanOp& firstOp = plan.operations.front();
    const BitmapFramePlanOp& lastOp = plan.operations.back();
    (void)firstOp;
    (void)lastOp;
  }

  long firstExecutedFrame = -1;
  bool firstExecutedClearTexture = false;
  std::string firstExecutedPlanSummary;
  for (std::size_t index = 0; index < plan.operations.size(); index += 1) {
    const BitmapFramePlanOp& op = plan.operations[index];
    if (op.frame < firstOperationFrame) {
      continue;
    }
    const bool clearTexture =
      seededFromGpuCheckpoint
        ? op.drawPlan.clearsSurface
        : (replayFromScratch ? (executedOps == 0 ? true : op.drawPlan.clearsSurface) : op.drawPlan.clearsSurface);
    if (firstExecutedFrame < 0) {
      firstExecutedFrame = op.frame;
      firstExecutedClearTexture = clearTexture;
      firstExecutedPlanSummary = SummarizeGpuDrawPlanForTrace(op.drawPlan);
    }
    err = RenderDrawPlanToTexture(
      commandBuffer,
      rendererState,
      canvasState.texture,
      canvasState.scratchTexture,
      op.drawPlan,
      plan.cacheKey,
      clearTexture,
      nullptr,
      errorMessage
    );
    if (err != PF_Err_NONE) {
      DisposeMetalBitmapGpuStateByCacheKey(plan.cacheKey, "draw-plan-failed");
      return err;
    }
    executedOps += 1;
    executedFills += op.drawPlan.fillTriangles.size();
    executedStrokes += op.drawPlan.strokeTriangles.size();
    executedImages += op.drawPlan.imageDraws.size();
  }

  if (!seededFromGpuCheckpoint &&
      replayFromScratch &&
      executedOps == 0) {
    GpuRenderPlan clearPlan;
    clearPlan.width = plan.width;
    clearPlan.height = plan.height;
    clearPlan.clearColor = PF_Pixel{0, 0, 0, 0};
    clearPlan.clearsSurface = true;
    err = RenderDrawPlanToTexture(
      commandBuffer,
      rendererState,
      canvasState.texture,
      canvasState.scratchTexture,
      clearPlan,
      plan.cacheKey,
      true,
      nullptr,
      errorMessage
    );
    if (err != PF_Err_NONE) {
      DisposeMetalBitmapGpuStateByCacheKey(plan.cacheKey, "zero-op-clear-failed");
      return err;
    }
  }

  (void)firstExecutedFrame;
  (void)firstExecutedClearTexture;
  (void)firstExecutedPlanSummary;
  (void)executedFills;
  (void)executedStrokes;
  (void)executedImages;
  (void)useRecoveryCanvas;
  (void)seededFromGpuCheckpoint;

  id<MTLTexture> exactFrameTextureToStore = CreateRenderTexture(device, plan.width, plan.height, errorMessage);
  if (exactFrameTextureToStore) {
    err = EncodeCopyTextureRaw(
      commandBuffer,
      rendererState,
      plan.width,
      plan.height,
      canvasState.texture,
      exactFrameTextureToStore,
      errorMessage
    );
    if (err != PF_Err_NONE) {
      [exactFrameTextureToStore release];
      exactFrameTextureToStore = nil;
      DisposeMetalBitmapGpuStateByCacheKey(plan.cacheKey, "exact-frame-store-copy-failed");
      return err;
    }
  }

  const bool shouldStoreCheckpoint =
    !useRecoveryCanvas &&
    plan.profile == BITMAP_GPU_PROFILE_STATEFUL_ACCUMULATION &&
    plan.checkpointInterval > 0 &&
    plan.targetFrame > 0 &&
    (plan.targetFrame % plan.checkpointInterval) == 0;

  err = EncodeCopyTextureToOutput(commandBuffer, rendererState, canvasState.texture, target, errorMessage);
  if (err != PF_Err_NONE) {
    if (exactFrameTextureToStore) {
      [exactFrameTextureToStore release];
      exactFrameTextureToStore = nil;
    }
    DisposeMetalBitmapGpuStateByCacheKey(plan.cacheKey, "output-copy-failed");
    return err;
  }

  err = CommitAndWait(commandBuffer, errorMessage);
  if (err != PF_Err_NONE) {
    if (exactFrameTextureToStore) {
      [exactFrameTextureToStore release];
      exactFrameTextureToStore = nil;
    }
    DisposeMetalBitmapGpuStateByCacheKey(plan.cacheKey, "commit-failed");
    return err;
  }

  canvasState.lastFrame = plan.targetFrame;
  canvasState.initialized = true;
  if (useRecoveryCanvas) {
    UpdateRecoveryCache(plan.cacheKey, canvasState);
  } else {
    UpdateAccumulationCache(plan.cacheKey, canvasState);
  }
  if (exactFrameTextureToStore) {
    if (shouldStoreCheckpoint) {
      [exactFrameTextureToStore retain];
      StoreMetalCanvasCheckpoint(plan.cacheKey, plan.targetFrame, plan.width, plan.height, exactFrameTextureToStore);
    }
    StoreMetalExactFrameTexture(plan.cacheKey, plan.targetFrame, plan.width, plan.height, exactFrameTextureToStore);
    exactFrameTextureToStore = nil;
  }
  return PF_Err_NONE;
}

}  // namespace momentum
