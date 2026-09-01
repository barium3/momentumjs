#include "rendering/bitmap/backends/compute/executor.h"

#include "rendering/bitmap/backends/compute/geometry.h"
#include "rendering/bitmap/planning/planner.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace momentum {
namespace bitmap {
namespace compute {
namespace {

constexpr std::size_t kPixelByteSize = sizeof(Float4);

void SetError(std::string* errorMessage, const std::string& value) {
  if (errorMessage) {
    *errorMessage = value;
  }
}

Float4 StraightColor(const PF_Pixel& color) {
  return Float4{
    static_cast<float>(color.red) / 255.0f,
    static_cast<float>(color.green) / 255.0f,
    static_cast<float>(color.blue) / 255.0f,
    static_cast<float>(color.alpha) / 255.0f
  };
}

Float4 PremultipliedColor(const PF_Pixel& color) {
  Float4 value = StraightColor(color);
  value.x *= value.w;
  value.y *= value.w;
  value.z *= value.w;
  return value;
}

bool CheckedPixelBytes(
  std::uint32_t width,
  std::uint32_t height,
  std::size_t* byteSize
) {
  if (!byteSize || width == 0 || height == 0) {
    return false;
  }
  const std::size_t pixels = static_cast<std::size_t>(width) * height;
  if (pixels > std::numeric_limits<std::size_t>::max() / kPixelByteSize) {
    return false;
  }
  *byteSize = pixels * kPixelByteSize;
  return true;
}

class BufferPool {
 public:
  explicit BufferPool(const gpu::Target& target)
    : target_(target) {}

  ~BufferPool() {
    if (!target_.deviceSuite || !target_.inData) {
      return;
    }
    for (auto it = buffers_.rbegin(); it != buffers_.rend(); ++it) {
      if (it->memory) {
        (void)target_.deviceSuite->FreeDeviceMemory(
          target_.inData->effect_ref,
          target_.deviceIndex,
          it->memory
        );
      }
    }
  }

  bool Allocate(
    std::size_t byteSize,
    const char* label,
    Buffer* output,
    std::string* errorMessage
  ) {
    if (!output || !target_.deviceSuite || !target_.inData || byteSize == 0) {
      SetError(errorMessage, "Bitmap compute allocation request is invalid.");
      return false;
    }
    void* memory = nullptr;
    const PF_Err error = target_.deviceSuite->AllocateDeviceMemory(
      target_.inData->effect_ref,
      target_.deviceIndex,
      byteSize,
      &memory
    );
    if (error != PF_Err_NONE || !memory) {
      SetError(
        errorMessage,
        std::string("Failed to allocate GPU memory for ") +
          (label ? label : "Bitmap compute resource") + "."
      );
      return false;
    }
    Buffer buffer{memory, byteSize};
    buffers_.push_back(buffer);
    *output = buffer;
    return true;
  }

  template <typename T>
  bool AllocateAndUpload(
    Device& device,
    const std::vector<T>& values,
    const Buffer& emptyFallback,
    const char* label,
    Buffer* output,
    std::string* errorMessage
  ) {
    if (!output) {
      return false;
    }
    if (values.empty()) {
      *output = emptyFallback;
      return true;
    }
    const std::size_t byteSize = values.size() * sizeof(T);
    if (!Allocate(byteSize, label, output, errorMessage)) {
      return false;
    }
    return device.Upload(*output, values.data(), byteSize, errorMessage);
  }

 private:
  const gpu::Target& target_;
  std::vector<Buffer> buffers_;
};

struct ImageResource {
  Buffer buffer;
  std::uint32_t width = 0;
  std::uint32_t height = 0;
};

class Runner {
 public:
  Runner(
    Device& device,
    const gpu::Target& target,
    BufferPool& buffers,
    std::string* errorMessage
  )
    : device_(device),
      target_(target),
      buffers_(buffers),
      errorMessage_(errorMessage) {}

  bool Initialize() {
    const Float4 white{1.0f, 1.0f, 1.0f, 1.0f};
    const std::uint32_t zero = 0;
    if (!buffers_.Allocate(sizeof(Float4), "white clip pixel", &whiteClip_, errorMessage_) ||
        !device_.Upload(whiteClip_, &white, sizeof(white), errorMessage_) ||
        !buffers_.Allocate(sizeof(Float4), "dummy compute buffer", &dummy_, errorMessage_) ||
        !device_.Upload(dummy_, &zero, sizeof(zero), errorMessage_)) {
      return false;
    }
    return true;
  }

  bool Run(const BitmapFramePlan& plan) {
    if (!plan.supported) {
      SetError(
        errorMessage_,
        plan.unsupportedReason.empty()
          ? "Bitmap frame plan is unsupported by the GPU executor."
          : plan.unsupportedReason
      );
      return false;
    }
    if (plan.width <= 0 || plan.height <= 0 ||
        plan.fallbackSurfaceStart != BITMAP_SURFACE_CLEAR) {
      SetError(
        errorMessage_,
        "Bitmap GPU execution requires a positive, correctness-complete frame plan."
      );
      return false;
    }

    const std::uint32_t width = static_cast<std::uint32_t>(plan.width);
    const std::uint32_t height = static_cast<std::uint32_t>(plan.height);
    std::size_t canvasBytes = 0;
    if (!CheckedPixelBytes(width, height, &canvasBytes) ||
        !buffers_.Allocate(canvasBytes, "Bitmap canvas", &canvas_, errorMessage_) ||
        !buffers_.Allocate(canvasBytes, "Bitmap scratch canvas", &scratch_, errorMessage_)) {
      return false;
    }
    if (!device_.Clear(
          canvas_, width, height, PremultipliedColor(plan.fallbackSurfaceColor), errorMessage_)) {
      return false;
    }

    for (const BitmapFramePlanOp& operation : plan.operations) {
      if (!RenderDrawPlan(
            canvas_,
            scratch_,
            operation.drawPlan,
            operation.drawPlan.surfaceStart,
            operation.drawPlan.surfaceColor)) {
        return false;
      }
    }

    CopyOutputParams copy;
    copy.width = static_cast<std::uint32_t>(std::max<A_long>(0, target_.outputWorld->width));
    copy.height = static_cast<std::uint32_t>(std::max<A_long>(0, target_.outputWorld->height));
    copy.rowPixels = static_cast<std::uint32_t>(
      target_.outputWorld->rowbytes / static_cast<A_long>(sizeof(Float4))
    );
    copy.sourceWidth = width;
    copy.sourceHeight = height;
    copy.logicalWidth = static_cast<std::uint32_t>(std::max<A_long>(1, target_.logicalWidth));
    copy.logicalHeight = static_cast<std::uint32_t>(std::max<A_long>(1, target_.logicalHeight));
    copy.sourceOriginX = static_cast<float>(std::max(0.0, target_.sourceOriginX));
    copy.sourceOriginY = static_cast<float>(std::max(0.0, target_.sourceOriginY));
    copy.sourceStepX = static_cast<float>(std::max(0.0, target_.sourceStepX));
    copy.sourceStepY = static_cast<float>(std::max(0.0, target_.sourceStepY));
    return device_.CopyToOutput(
      canvas_, target_.outputWorldData, copy, errorMessage_
    );
  }

 private:
  bool RenderDrawPlan(
    const Buffer& targetBuffer,
    const Buffer& scratchBuffer,
    const BitmapDrawPlan& plan,
    BitmapSurfaceStart surfaceStart,
    const PF_Pixel& surfaceColor
  ) {
    if (plan.width <= 0 || plan.height <= 0) {
      SetError(errorMessage_, "Bitmap draw plan has invalid dimensions.");
      return false;
    }
    const std::uint32_t width = static_cast<std::uint32_t>(plan.width);
    const std::uint32_t height = static_cast<std::uint32_t>(plan.height);
    if (surfaceStart == BITMAP_SURFACE_CLEAR &&
        !device_.Clear(
          targetBuffer, width, height, PremultipliedColor(surfaceColor), errorMessage_)) {
      return false;
    }

    std::vector<Float2> vertices;
    vertices.reserve(plan.pathFillVertices.size());
    for (const auto& vertex : plan.pathFillVertices) {
      vertices.push_back(Float2{vertex.x, vertex.y});
    }
    std::vector<PathFillContour> contours;
    contours.reserve(plan.pathFillContours.size());
    for (const auto& contour : plan.pathFillContours) {
      contours.push_back(PathFillContour{contour.vertexStart, contour.vertexCount});
    }

    Buffer vertexBuffer;
    Buffer contourBuffer;
    if (!buffers_.AllocateAndUpload(
          device_, vertices, dummy_, "path vertices", &vertexBuffer, errorMessage_) ||
        !buffers_.AllocateAndUpload(
          device_, contours, dummy_, "path contours", &contourBuffer, errorMessage_)) {
      return false;
    }

    std::unordered_map<int, ImageResource> images;
    auto resolveImage = [&](int imageId, ImageResource* output) -> bool {
      return ResolveImage(plan, imageId, &images, output);
    };

    std::vector<BitmapDrawPlan::DrawBatch> batches = EffectiveBatches(plan);
    for (const BitmapDrawPlan::DrawBatch& batch : batches) {
      if (batch.type == BitmapDrawPlan::DRAW_BATCH_FILTERS) {
        if (!RunFilters(targetBuffer, scratchBuffer, plan, batch)) {
          return false;
        }
        continue;
      }
      if (batch.type == BitmapDrawPlan::DRAW_BATCH_MASKS) {
        if (!RunMasks(targetBuffer, scratchBuffer, plan, batch, &images)) {
          return false;
        }
        continue;
      }

      const bool composite = batch.erase || batch.blendMode != BLEND_MODE_BLEND;
      const Buffer& destination = composite ? scratchBuffer : targetBuffer;
      if (composite && !device_.Clear(
            scratchBuffer, width, height, Float4{}, errorMessage_)) {
        return false;
      }
      if (!RunDrawBatch(
            destination,
            plan,
            batch,
            vertexBuffer,
            contourBuffer,
            &images,
            resolveImage)) {
        return false;
      }
      if (composite) {
        BlendParams params;
        params.width = width;
        params.height = height;
        params.blendMode = batch.blendMode;
        params.erase = batch.erase ? 1U : 0U;
        params.eraseStrength = std::max(0.0f, batch.eraseStrength);
        if (!device_.Composite(
              scratchBuffer, targetBuffer, params, errorMessage_)) {
          return false;
        }
      }
    }
    return true;
  }

  std::vector<BitmapDrawPlan::DrawBatch> EffectiveBatches(
    const BitmapDrawPlan& plan
  ) const {
    if (!plan.drawBatches.empty()) {
      return plan.drawBatches;
    }
    std::vector<BitmapDrawPlan::DrawBatch> batches;
    auto append = [&](BitmapDrawPlan::DrawBatchType type, std::size_t count) {
      if (count == 0) {
        return;
      }
      BitmapDrawPlan::DrawBatch batch;
      batch.type = type;
      batch.count = count;
      batches.push_back(batch);
    };
    append(BitmapDrawPlan::DRAW_BATCH_FILLS, plan.fillTriangles.size());
    append(BitmapDrawPlan::DRAW_BATCH_STROKES, plan.strokeTriangles.size());
    if (!batches.empty() && batches.back().type == BitmapDrawPlan::DRAW_BATCH_STROKES) {
      batches.back().explicitEdgeCount = plan.strokeBoundaryEdges.size();
    }
    append(BitmapDrawPlan::DRAW_BATCH_IMAGES, plan.imageDraws.size());
    append(BitmapDrawPlan::DRAW_BATCH_PATH_FILLS, plan.pathFills.size());
    append(BitmapDrawPlan::DRAW_BATCH_FILTERS, plan.filterPasses.size());
    append(BitmapDrawPlan::DRAW_BATCH_MASKS, plan.maskPasses.size());
    return batches;
  }

  template <typename Resolver>
  bool RunDrawBatch(
    const Buffer& destination,
    const BitmapDrawPlan& plan,
    const BitmapDrawPlan::DrawBatch& batch,
    const Buffer& vertexBuffer,
    const Buffer& contourBuffer,
    std::unordered_map<int, ImageResource>* images,
    Resolver& resolveImage
  ) {
    ImageResource clip{whiteClip_, 1, 1};
    if (batch.clipImageId != 0 && !resolveImage(batch.clipImageId, &clip)) {
      return false;
    }

    if (batch.type == BitmapDrawPlan::DRAW_BATCH_FILLS ||
        batch.type == BitmapDrawPlan::DRAW_BATCH_STROKES) {
      const auto& triangleSource =
        batch.type == BitmapDrawPlan::DRAW_BATCH_FILLS
          ? plan.fillTriangles
          : plan.strokeTriangles;
      const auto& edgeSource =
        batch.type == BitmapDrawPlan::DRAW_BATCH_FILLS
          ? plan.boundaryEdges
          : plan.strokeBoundaryEdges;
      if (batch.start > triangleSource.size() ||
          batch.count > triangleSource.size() - batch.start) {
        SetError(errorMessage_, "Bitmap fill/stroke batch is out of range.");
        return false;
      }
      if (batch.count == 0) {
        return true;
      }
      const FillBatchGeometry geometry =
        BuildTriangleBatchGeometry(triangleSource, edgeSource, batch);
      if (geometry.triangles.empty() || !geometry.hasBounds) {
        return true;
      }
      Buffer triangles;
      Buffer edges;
      if (!buffers_.AllocateAndUpload(
            device_, geometry.triangles, dummy_, "fill triangles", &triangles, errorMessage_) ||
          !buffers_.AllocateAndUpload(
            device_, geometry.boundaryEdges, dummy_, "fill edges", &edges, errorMessage_)) {
        return false;
      }

      const int startX = std::max(0, static_cast<int>(std::floor(geometry.bounds.x - 1.0f)));
      const int startY = std::max(0, static_cast<int>(std::floor(geometry.bounds.y - 1.0f)));
      const int endX = std::min(
        static_cast<int>(plan.width),
        static_cast<int>(std::ceil(geometry.bounds.z + 1.0f))
      );
      const int endY = std::min(
        static_cast<int>(plan.height),
        static_cast<int>(std::ceil(geometry.bounds.w + 1.0f))
      );
      if (endX <= startX || endY <= startY) {
        return true;
      }
      const Float4 color = StraightColor(triangleSource[batch.start].color);
      FillParams params;
      params.regionOriginX = static_cast<std::uint32_t>(startX);
      params.regionOriginY = static_cast<std::uint32_t>(startY);
      params.regionWidth = static_cast<std::uint32_t>(endX - startX);
      params.regionHeight = static_cast<std::uint32_t>(endY - startY);
      params.canvasWidth = static_cast<std::uint32_t>(plan.width);
      params.canvasHeight = static_cast<std::uint32_t>(plan.height);
      params.triangleCount = static_cast<std::uint32_t>(geometry.triangles.size());
      params.edgeCount = static_cast<std::uint32_t>(geometry.boundaryEdges.size());
      params.clipContourStart = batch.hasAnalyticClip ? batch.clipContourStart : 0U;
      params.clipContourCount = batch.hasAnalyticClip ? batch.clipContourCount : 0U;
      params.clipWidth = clip.width;
      params.clipHeight = clip.height;
      params.colorR = color.x;
      params.colorG = color.y;
      params.colorB = color.z;
      params.colorA = color.w;
      params.boundsMinX = geometry.bounds.x;
      params.boundsMinY = geometry.bounds.y;
      params.boundsMaxX = geometry.bounds.z;
      params.boundsMaxY = geometry.bounds.w;
      params.clipMinX = batch.clipMinX;
      params.clipMinY = batch.clipMinY;
      params.clipMaxX = batch.clipMaxX;
      params.clipMaxY = batch.clipMaxY;
      return device_.Fill(
        destination,
        triangles,
        edges,
        vertexBuffer,
        contourBuffer,
        clip.buffer,
        params,
        errorMessage_
      );
    }

    if (batch.type == BitmapDrawPlan::DRAW_BATCH_PATH_FILLS) {
      if (batch.start > plan.pathFills.size() ||
          batch.count > plan.pathFills.size() - batch.start) {
        SetError(errorMessage_, "Bitmap path-fill batch is out of range.");
        return false;
      }
      for (std::size_t index = 0; index < batch.count; ++index) {
        const BitmapDrawPlan::PathFill& fill = plan.pathFills[batch.start + index];
        if (fill.contourCount == 0) {
          continue;
        }
        const int startX = std::max(0, static_cast<int>(std::floor(fill.minX - 1.0f)));
        const int startY = std::max(0, static_cast<int>(std::floor(fill.minY - 1.0f)));
        const int endX = std::min(
          static_cast<int>(plan.width), static_cast<int>(std::ceil(fill.maxX + 1.0f))
        );
        const int endY = std::min(
          static_cast<int>(plan.height), static_cast<int>(std::ceil(fill.maxY + 1.0f))
        );
        if (endX <= startX || endY <= startY) {
          continue;
        }
        const Float4 color = StraightColor(fill.color);
        PathFillParams params;
        params.regionOriginX = static_cast<std::uint32_t>(startX);
        params.regionOriginY = static_cast<std::uint32_t>(startY);
        params.regionWidth = static_cast<std::uint32_t>(endX - startX);
        params.regionHeight = static_cast<std::uint32_t>(endY - startY);
        params.canvasWidth = static_cast<std::uint32_t>(plan.width);
        params.canvasHeight = static_cast<std::uint32_t>(plan.height);
        params.contourStart = fill.contourStart;
        params.contourCount = fill.contourCount;
        params.clipContourStart = batch.hasAnalyticClip ? batch.clipContourStart : 0U;
        params.clipContourCount = batch.hasAnalyticClip ? batch.clipContourCount : 0U;
        params.clipWidth = clip.width;
        params.clipHeight = clip.height;
        params.colorR = color.x;
        params.colorG = color.y;
        params.colorB = color.z;
        params.colorA = color.w;
        params.boundsMinX = fill.minX;
        params.boundsMinY = fill.minY;
        params.boundsMaxX = fill.maxX;
        params.boundsMaxY = fill.maxY;
        params.clipMinX = batch.clipMinX;
        params.clipMinY = batch.clipMinY;
        params.clipMaxX = batch.clipMaxX;
        params.clipMaxY = batch.clipMaxY;
        if (!device_.PathFill(
              destination,
              vertexBuffer,
              contourBuffer,
              clip.buffer,
              params,
              errorMessage_)) {
          return false;
        }
      }
      return true;
    }

    if (batch.type == BitmapDrawPlan::DRAW_BATCH_IMAGES ||
        batch.type == BitmapDrawPlan::DRAW_BATCH_TEXT_IMAGES) {
      if (batch.start > plan.imageDraws.size() ||
          batch.count > plan.imageDraws.size() - batch.start) {
        SetError(errorMessage_, "Bitmap image batch is out of range.");
        return false;
      }
      for (std::size_t index = 0; index < batch.count; ++index) {
        const BitmapDrawPlan::ImageDraw& draw = plan.imageDraws[batch.start + index];
        ImageResource image;
        if (!resolveImage(draw.imageId, &image)) {
          return false;
        }
        const float minX = std::min({draw.x1, draw.x2, draw.x3, draw.x4});
        const float minY = std::min({draw.y1, draw.y2, draw.y3, draw.y4});
        const float maxX = std::max({draw.x1, draw.x2, draw.x3, draw.x4});
        const float maxY = std::max({draw.y1, draw.y2, draw.y3, draw.y4});
        const int startX = std::max(0, static_cast<int>(std::floor(minX)));
        const int startY = std::max(0, static_cast<int>(std::floor(minY)));
        const int endX = std::min(
          static_cast<int>(plan.width), static_cast<int>(std::ceil(maxX))
        );
        const int endY = std::min(
          static_cast<int>(plan.height), static_cast<int>(std::ceil(maxY))
        );
        if (endX <= startX || endY <= startY) {
          continue;
        }
        const Float4 tint = StraightColor(draw.tint);
        ImageParams params;
        params.regionOriginX = static_cast<std::uint32_t>(startX);
        params.regionOriginY = static_cast<std::uint32_t>(startY);
        params.regionWidth = static_cast<std::uint32_t>(endX - startX);
        params.regionHeight = static_cast<std::uint32_t>(endY - startY);
        params.canvasWidth = static_cast<std::uint32_t>(plan.width);
        params.canvasHeight = static_cast<std::uint32_t>(plan.height);
        params.imageWidth = image.width;
        params.imageHeight = image.height;
        params.clipWidth = clip.width;
        params.clipHeight = clip.height;
        params.textImage =
          batch.type == BitmapDrawPlan::DRAW_BATCH_TEXT_IMAGES ? 1U : 0U;
        params.x1 = draw.x1; params.y1 = draw.y1; params.u1 = draw.u1; params.v1 = draw.v1;
        params.x2 = draw.x2; params.y2 = draw.y2; params.u2 = draw.u2; params.v2 = draw.v2;
        params.x3 = draw.x3; params.y3 = draw.y3; params.u3 = draw.u3; params.v3 = draw.v3;
        params.x4 = draw.x4; params.y4 = draw.y4; params.u4 = draw.u4; params.v4 = draw.v4;
        params.tintR = tint.x;
        params.tintG = tint.y;
        params.tintB = tint.z;
        params.tintA = tint.w;
        if (!device_.Image(
              destination, image.buffer, clip.buffer, params, errorMessage_)) {
          return false;
        }
      }
      return true;
    }

    (void)images;
    SetError(errorMessage_, "Bitmap GPU draw plan contains an unknown batch type.");
    return false;
  }

  bool RunFilters(
    const Buffer& targetBuffer,
    const Buffer& scratchBuffer,
    const BitmapDrawPlan& plan,
    const BitmapDrawPlan::DrawBatch& batch
  ) {
    if (batch.start > plan.filterPasses.size() ||
        batch.count > plan.filterPasses.size() - batch.start) {
      SetError(errorMessage_, "Bitmap filter batch is out of range.");
      return false;
    }
    Buffer source = targetBuffer;
    Buffer destination = scratchBuffer;
    for (std::size_t index = 0; index < batch.count; ++index) {
      const BitmapDrawPlan::FilterPass& pass = plan.filterPasses[batch.start + index];
      FilterParams params;
      params.width = static_cast<std::uint32_t>(plan.width);
      params.height = static_cast<std::uint32_t>(plan.height);
      params.filterKind = pass.filterKind;
      params.value = pass.value;
      if (!device_.Filter(source, destination, params, errorMessage_)) {
        return false;
      }
      std::swap(source, destination);
    }
    return source.memory == targetBuffer.memory ||
      device_.Copy(
        source,
        targetBuffer,
        static_cast<std::uint32_t>(plan.width),
        static_cast<std::uint32_t>(plan.height),
        errorMessage_
      );
  }

  bool RunMasks(
    const Buffer& targetBuffer,
    const Buffer& scratchBuffer,
    const BitmapDrawPlan& plan,
    const BitmapDrawPlan::DrawBatch& batch,
    std::unordered_map<int, ImageResource>* images
  ) {
    if (batch.start > plan.maskPasses.size() ||
        batch.count > plan.maskPasses.size() - batch.start) {
      SetError(errorMessage_, "Bitmap mask batch is out of range.");
      return false;
    }
    for (std::size_t index = 0; index < batch.count; ++index) {
      const BitmapDrawPlan::MaskPass& pass = plan.maskPasses[batch.start + index];
      ImageResource mask;
      if (!ResolveImage(plan, pass.maskImageId, images, &mask) ||
          !device_.Mask(
            targetBuffer,
            mask.buffer,
            scratchBuffer,
            static_cast<std::uint32_t>(plan.width),
            static_cast<std::uint32_t>(plan.height),
            mask.width,
            mask.height,
            errorMessage_) ||
          !device_.Copy(
            scratchBuffer,
            targetBuffer,
            static_cast<std::uint32_t>(plan.width),
            static_cast<std::uint32_t>(plan.height),
            errorMessage_)) {
        return false;
      }
    }
    return true;
  }

  bool ResolveImage(
    const BitmapDrawPlan& parentPlan,
    int imageId,
    std::unordered_map<int, ImageResource>* images,
    ImageResource* output
  ) {
    if (!images || !output || imageId <= 0) {
      SetError(errorMessage_, "Bitmap GPU image reference is invalid.");
      return false;
    }
    const auto existing = images->find(imageId);
    if (existing != images->end()) {
      *output = existing->second;
      return true;
    }
    const auto assetIt = parentPlan.scene.imageAssets.find(imageId);
    if (assetIt == parentPlan.scene.imageAssets.end()) {
      SetError(errorMessage_, "Bitmap GPU image reference is unknown.");
      return false;
    }
    const RuntimeImageAsset& asset = assetIt->second;
    if (!asset.loaded || asset.width <= 0 || asset.height <= 0) {
      SetError(errorMessage_, "Bitmap GPU image asset is not loaded.");
      return false;
    }
    const std::uint32_t width = static_cast<std::uint32_t>(asset.width);
    const std::uint32_t height = static_cast<std::uint32_t>(asset.height);
    std::size_t byteSize = 0;
    ImageResource resource;
    resource.width = width;
    resource.height = height;
    if (!CheckedPixelBytes(width, height, &byteSize) ||
        !buffers_.Allocate(byteSize, "Bitmap image", &resource.buffer, errorMessage_)) {
      return false;
    }
    (*images)[imageId] = resource;

    if (asset.sceneBacked && asset.sceneSource) {
      if (imageRenderStack_.find(imageId) != imageRenderStack_.end()) {
        SetError(errorMessage_, "Detected recursive scene-backed image dependency.");
        return false;
      }
      Buffer scratch;
      if (!buffers_.Allocate(byteSize, "scene-backed image scratch", &scratch, errorMessage_)) {
        return false;
      }
      imageRenderStack_.insert(imageId);
      PF_LayerDef sceneOutput{};
      sceneOutput.width = asset.width;
      sceneOutput.height = asset.height;
      BitmapDrawPlan scenePlan;
      std::string planError;
      const bool planned = planning::Build(
        &sceneOutput,
        parentPlan.cacheKey,
        parentPlan.targetFrame,
        *asset.sceneSource,
        &scenePlan,
        &planError
      );
      const bool rendered = planned && RenderDrawPlan(
        resource.buffer,
        scratch,
        scenePlan,
        BITMAP_SURFACE_CLEAR,
        scenePlan.surfaceStart == BITMAP_SURFACE_CLEAR
          ? scenePlan.surfaceColor
          : PF_Pixel{0, 0, 0, 0}
      );
      imageRenderStack_.erase(imageId);
      if (!planned || !rendered) {
        if (!planned) {
          SetError(
            errorMessage_,
            planError.empty()
              ? "Failed to plan scene-backed image for GPU execution."
              : planError
          );
        }
        return false;
      }
    } else {
      const std::vector<PF_Pixel>& source = ReadImagePixels(asset);
      const std::size_t pixelCount = static_cast<std::size_t>(width) * height;
      if (source.size() < pixelCount) {
        SetError(errorMessage_, "Bitmap GPU image asset has incomplete pixels.");
        return false;
      }
      std::vector<Float4> pixels(pixelCount);
      for (std::size_t index = 0; index < pixelCount; ++index) {
        pixels[index] = PremultipliedColor(source[index]);
      }
      if (!device_.Upload(
            resource.buffer, pixels.data(), byteSize, errorMessage_)) {
        return false;
      }
    }

    *output = resource;
    return true;
  }

  Device& device_;
  const gpu::Target& target_;
  BufferPool& buffers_;
  std::string* errorMessage_ = nullptr;
  Buffer whiteClip_;
  Buffer dummy_;
  Buffer canvas_;
  Buffer scratch_;
  std::unordered_set<int> imageRenderStack_;
};

}  // namespace

PF_Err Execute(
  Device& device,
  const gpu::Target& target,
  const BitmapFramePlan& plan,
  std::string* errorMessage
) {
  if (!target.inData || !target.deviceSuite || !target.outputWorld ||
      !target.outputWorldData) {
    SetError(errorMessage, "Bitmap compute target is missing AE GPU resources.");
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  if (target.pixelFormat != PF_PixelFormat_GPU_BGRA128) {
    SetError(errorMessage, "Bitmap compute backends require GPU BGRA128 output.");
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  BufferPool buffers(target);
  Runner runner(device, target, buffers, errorMessage);
  const bool initialized = runner.Initialize();
  const bool rendered = initialized && runner.Run(plan);
  std::string finishError;
  const bool finished = device.Finish(
    rendered ? errorMessage : &finishError
  );
  if (!rendered || !finished) {
    if (!rendered && errorMessage && errorMessage->empty() && !finishError.empty()) {
      *errorMessage = finishError;
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  return PF_Err_NONE;
}

}  // namespace compute
}  // namespace bitmap
}  // namespace momentum
