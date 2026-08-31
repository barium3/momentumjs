#include "rendering/bitmap/backends/cpu/renderer.h"

#include "rendering/software/rasterizer.h"

#include <algorithm>

namespace momentum {
namespace bitmap {
namespace cpu {

bool Render(
  const BitmapFramePlan& plan,
  std::vector<PF_Pixel>* raster,
  const std::function<bool()>& shouldCancel,
  std::string* errorMessage
) {
  if (!raster || plan.width <= 0 || plan.height <= 0) {
    if (errorMessage) {
      *errorMessage = "Bitmap CPU executor received an invalid frame plan.";
    }
    return false;
  }
  if (!plan.supported) {
    if (errorMessage) {
      *errorMessage = plan.unsupportedReason.empty()
        ? "Bitmap frame plan is not supported by the CPU executor."
        : plan.unsupportedReason;
    }
    return false;
  }

  const PF_Pixel initialPixel =
    plan.fallbackSurfaceStart == BITMAP_SURFACE_CLEAR
      ? plan.fallbackSurfaceColor
      : PF_Pixel{0, 0, 0, 0};
  raster->assign(
    static_cast<std::size_t>(plan.width * plan.height),
    initialPixel
  );

  for (const BitmapFramePlanOp& operation : plan.operations) {
    if (shouldCancel && shouldCancel()) {
      if (errorMessage) {
        *errorMessage = "render-cancelled";
      }
      return false;
    }
    if (operation.drawPlan.surfaceStart == BITMAP_SURFACE_CLEAR) {
      std::fill(
        raster->begin(),
        raster->end(),
        operation.drawPlan.surfaceColor
      );
    }
    if (!RenderSceneToRaster8(
          raster,
          plan.width,
          plan.height,
          operation.drawPlan.scene,
          shouldCancel
        )) {
      if (errorMessage) {
        *errorMessage = "render-cancelled";
      }
      return false;
    }
  }
  return true;
}

}  // namespace cpu
}  // namespace bitmap
}  // namespace momentum
