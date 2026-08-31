#include <cassert>
#include <vector>

#include "scene/types.h"

int main() {
  using namespace momentum;

  RuntimeImageAsset original;
  original.id = 1;
  original.width = 2;
  original.height = 1;
  original.loaded = true;
  ReplaceImagePixels(
    &original,
    std::vector<PF_Pixel>{
      PF_Pixel{255, 10, 20, 30},
      PF_Pixel{255, 40, 50, 60},
    }
  );

  RuntimeImageAsset frameCopy = original;
  assert(frameCopy.pixelBuffer == original.pixelBuffer);

  std::vector<PF_Pixel>& writable = AcquireWritableImagePixels(frameCopy);
  writable[0] = PF_Pixel{255, 200, 201, 202};
  frameCopy.version += 1;

  assert(frameCopy.pixelBuffer != original.pixelBuffer);
  assert(ReadImagePixels(original)[0].red == 10);
  assert(ReadImagePixels(frameCopy)[0].red == 200);
  assert(ReadImagePixels(original)[1].green == 50);
  assert(frameCopy.version == original.version + 1);
  return 0;
}
