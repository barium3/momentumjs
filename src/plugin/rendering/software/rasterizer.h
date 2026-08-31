#pragma once

#include <functional>

#include "scene/types.h"
namespace momentum {

PF_Pixel16 ToPixel16(const PF_Pixel& color);

Transform2D MakeIdentityTransform();
Transform2D MultiplyTransform(const Transform2D& left, const Transform2D& right);
Transform2D MakeTranslation(double x, double y);
Transform2D MakeRotation(double radians);
Transform2D MakeScale(double x, double y);
void ApplyTransform(const Transform2D& transform, double x, double y, double* outX, double* outY);
bool InvertTransform(const Transform2D& transform, Transform2D* inverse);
double ApproximateTransformScale(const Transform2D& transform);

PF_LayerDef MakeSurface8(A_long width, A_long height, std::vector<PF_Pixel>* pixels);
void CopySurface8To8(PF_LayerDef* output, const std::vector<PF_Pixel>& pixels);
void CopySurface8To16(PF_LayerDef* output, const std::vector<PF_Pixel>& pixels);

double ResolveScalarSpec(const ScalarSpec& spec, PF_LayerDef* output);
double GetSceneWidth(const ScenePayload& scene, PF_LayerDef* output);
double GetSceneHeight(const ScenePayload& scene, PF_LayerDef* output);
void ApplySceneToRaster8(
  std::vector<PF_Pixel>* raster,
  A_long width,
  A_long height,
  const ScenePayload& scene
);
bool RenderSceneToRaster8(
  std::vector<PF_Pixel>* raster,
  A_long width,
  A_long height,
  const ScenePayload& scene,
  const std::function<bool()>& shouldCancel,
  std::string* errorMessage = nullptr
);

}  // namespace momentum
