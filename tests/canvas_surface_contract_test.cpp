#include <cassert>
#include <cmath>
#include <string>
#include <vector>

#include "rendering/bitmap/backends/cpu/renderer.h"
#include "rendering/bitmap/planning/planner.h"
#include "rendering/software/rasterizer.h"
#include "rendering/software/text.h"

namespace {

using namespace momentum;
using bitmap::BITMAP_SURFACE_CLEAR;
using bitmap::BITMAP_SURFACE_INHERIT;
using bitmap::BitmapDrawPlan;
using bitmap::BitmapFramePlan;
using bitmap::BitmapFramePlanOp;

SceneCommand Background(PF_Pixel color) {
  SceneCommand command;
  command.type = "background";
  command.hasFill = true;
  command.hasStroke = false;
  command.fill = color;
  command.blendMode = BLEND_MODE_BLEND;
  command.transform = MakeIdentityTransform();
  return command;
}

SceneCommand MakePointCommand(double x, double y) {
  SceneCommand command;
  command.type = "point";
  command.hasFill = false;
  command.hasStroke = true;
  command.stroke = PF_Pixel{255, 255, 255, 255};
  command.strokeWeight = 1.0;
  command.x = {"pixels", x};
  command.y = {"pixels", y};
  command.transform = MakeIdentityTransform();
  return command;
}

SceneCommand MakeBoxTextCommand(double width) {
  SceneCommand command;
  command.type = "text";
  command.text = "Zero-width text must stay hidden";
  command.fontName = "Arial";
  command.fontSourceKind = "system";
  command.textSize = 12.0;
  command.textLeading = 15.0;
  command.textHasWidth = true;
  command.width = {"pixels", width};
  command.hasFill = true;
  command.fill = PF_Pixel{255, 255, 255, 255};
  command.transform = MakeIdentityTransform();
  return command;
}

BitmapDrawPlan BuildPlan(const ScenePayload& scene) {
  PF_LayerDef output{};
  output.width = 16;
  output.height = 16;
  BitmapDrawPlan plan;
  std::string error;
  const bool ok = bitmap::planning::Build(
    &output,
    1,
    0,
    scene,
    &plan,
    &error
  );
  assert(ok);
  assert(error.empty());
  return plan;
}

void AssertPixel(const PF_Pixel& actual, const PF_Pixel& expected) {
  assert(actual.alpha == expected.alpha);
  assert(actual.red == expected.red);
  assert(actual.green == expected.green);
  assert(actual.blue == expected.blue);
}

}  // namespace

int main() {
  using namespace momentum;

  {
    const SceneCommand command = MakeBoxTextCommand(0.0);

    TextLayoutMetrics metrics;
    assert(MeasureTextCommand(command, &metrics));
    assert(metrics.width == 0.0);
    assert(metrics.height == 0.0);

    RasterizedText rasterized;
    assert(RasterizeTextCommand(command, &rasterized));
    assert(rasterized.width == 0);
    assert(rasterized.height == 0);
    assert(rasterized.fillAlpha.empty());
    assert(rasterized.strokeAlpha.empty());

    GlyphAtlasTextRender glyphAtlas;
    assert(BuildGlyphAtlasTextCommand(command, 1, 2, &glyphAtlas));
    assert(!glyphAtlas.hasFillAtlas);
    assert(!glyphAtlas.hasStrokeAtlas);
    assert(glyphAtlas.fillQuads.empty());
    assert(glyphAtlas.strokeQuads.empty());
  }

  {
    ScenePayload scene;
    scene.canvasWidth = 16;
    scene.canvasHeight = 16;
    scene.commands.push_back(Background(PF_Pixel{255, 10, 20, 30}));
    scene.commands.push_back(MakePointCommand(1000.0, 8.0));
    const BitmapDrawPlan plan = BuildPlan(scene);
    assert(plan.surfaceStart == BITMAP_SURFACE_CLEAR);
    AssertPixel(plan.surfaceColor, PF_Pixel{255, 10, 20, 30});
  }

  {
    ScenePayload scene;
    scene.canvasWidth = 16;
    scene.canvasHeight = 16;
    scene.commands.push_back(Background(PF_Pixel{128, 0, 0, 0}));
    const BitmapDrawPlan plan = BuildPlan(scene);
    assert(plan.surfaceStart == BITMAP_SURFACE_INHERIT);
  }

  {
    ScenePayload scene;
    scene.canvasWidth = 16;
    scene.canvasHeight = 16;
    scene.commands.push_back(Background(PF_Pixel{128, 255, 0, 0}));
    scene.commands.push_back(MakePointCommand(2.0, 2.0));
    scene.commands.push_back(Background(PF_Pixel{255, 0, 0, 255}));
    scene.commands.push_back(MakePointCommand(1000.0, 8.0));
    const BitmapDrawPlan plan = BuildPlan(scene);
    assert(plan.surfaceStart == BITMAP_SURFACE_CLEAR);
    AssertPixel(plan.surfaceColor, PF_Pixel{255, 0, 0, 255});
  }

  {
    ScenePayload scene;
    scene.canvasWidth = 16;
    scene.canvasHeight = 16;
    scene.commands.push_back(MakePointCommand(2.0, 2.0));
    SceneCommand clear;
    clear.type = "clear";
    scene.commands.push_back(clear);
    const BitmapDrawPlan plan = BuildPlan(scene);
    assert(plan.surfaceStart == BITMAP_SURFACE_CLEAR);
    AssertPixel(plan.surfaceColor, PF_Pixel{0, 0, 0, 0});
    assert(plan.fillTriangles.empty());
    assert(plan.strokeTriangles.empty());
  }

  {
    BitmapFramePlan framePlan;
    framePlan.width = 2;
    framePlan.height = 2;

    BitmapFramePlanOp clearFrame;
    clearFrame.frame = 0;
    clearFrame.drawPlan.surfaceStart = BITMAP_SURFACE_CLEAR;
    clearFrame.drawPlan.surfaceColor = PF_Pixel{255, 200, 40, 20};
    clearFrame.drawPlan.scene.canvasWidth = 2;
    clearFrame.drawPlan.scene.canvasHeight = 2;
    framePlan.operations.push_back(clearFrame);

    BitmapFramePlanOp inheritedEmptyFrame;
    inheritedEmptyFrame.frame = 1;
    inheritedEmptyFrame.drawPlan.surfaceStart = BITMAP_SURFACE_INHERIT;
    inheritedEmptyFrame.drawPlan.scene.canvasWidth = 2;
    inheritedEmptyFrame.drawPlan.scene.canvasHeight = 2;
    framePlan.operations.push_back(inheritedEmptyFrame);

    std::vector<PF_Pixel> raster;
    std::string error;
    assert(bitmap::cpu::Render(
      framePlan,
      &raster,
      []() { return false; },
      &error
    ));
    assert(error.empty());
    assert(raster.size() == 4);
    for (const PF_Pixel& pixel : raster) {
      AssertPixel(pixel, PF_Pixel{255, 200, 40, 20});
    }
  }

  {
    // A self-contained inherited plan starts from its declared fallback, not
    // from whichever mutable GPU/CPU canvas happened to render previously.
    BitmapFramePlan framePlan;
    framePlan.width = 2;
    framePlan.height = 1;
    framePlan.fallbackSurfaceStart = BITMAP_SURFACE_CLEAR;
    framePlan.fallbackSurfaceColor = PF_Pixel{255, 9, 8, 7};

    BitmapFramePlanOp inheritedFrame;
    inheritedFrame.frame = 12;
    inheritedFrame.drawPlan.surfaceStart = BITMAP_SURFACE_INHERIT;
    inheritedFrame.drawPlan.scene.canvasWidth = 2;
    inheritedFrame.drawPlan.scene.canvasHeight = 1;
    framePlan.operations.push_back(inheritedFrame);

    std::vector<PF_Pixel> raster;
    std::string error;
    assert(bitmap::cpu::Render(
      framePlan,
      &raster,
      []() { return false; },
      &error
    ));
    assert(error.empty());
    assert(raster.size() == 2);
    for (const PF_Pixel& pixel : raster) {
      AssertPixel(pixel, framePlan.fallbackSurfaceColor);
    }
  }

  {
    BitmapFramePlan framePlan;
    framePlan.width = 1;
    framePlan.height = 1;

    BitmapFramePlanOp baseFrame;
    baseFrame.frame = 0;
    baseFrame.drawPlan.surfaceStart = BITMAP_SURFACE_CLEAR;
    baseFrame.drawPlan.surfaceColor = PF_Pixel{255, 200, 0, 0};
    baseFrame.drawPlan.scene.canvasWidth = 1;
    baseFrame.drawPlan.scene.canvasHeight = 1;
    framePlan.operations.push_back(baseFrame);

    BitmapFramePlanOp translucentFrame;
    translucentFrame.frame = 1;
    translucentFrame.drawPlan.surfaceStart = BITMAP_SURFACE_INHERIT;
    translucentFrame.drawPlan.scene.canvasWidth = 1;
    translucentFrame.drawPlan.scene.canvasHeight = 1;
    translucentFrame.drawPlan.scene.commands.push_back(
      Background(PF_Pixel{128, 0, 0, 0})
    );
    framePlan.operations.push_back(translucentFrame);

    std::vector<PF_Pixel> raster;
    std::string error;
    assert(bitmap::cpu::Render(
      framePlan,
      &raster,
      []() { return false; },
      &error
    ));
    assert(error.empty());
    assert(raster.size() == 1);
    assert(raster[0].alpha == 255);
    assert(std::abs(static_cast<int>(raster[0].red) - 100) <= 1);
    assert(raster[0].green == 0);
    assert(raster[0].blue == 0);
  }

  return 0;
}
