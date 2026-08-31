#include "rendering/software/image.h"

#include <iostream>
#include <string>

int main(int argc, char* argv[]) {
  if (argc != 2) {
    std::cerr << "Expected one image path\n";
    return 1;
  }

  momentum::RuntimeImageAsset asset;
  if (!momentum::LoadImageAssetFromFile(argv[1], 7, &asset)) {
    std::cerr << "WIC failed to decode: " << argv[1] << '\n';
    return 1;
  }
  if (!asset.loaded || asset.id != 7 ||
      asset.width <= 0 || asset.height <= 0) {
    std::cerr << "Decoded image metadata is invalid\n";
    return 1;
  }
  const std::vector<PF_Pixel>& pixels = momentum::ReadImagePixels(asset);
  const std::size_t expectedSize =
    static_cast<std::size_t>(asset.width) * asset.height;
  if (pixels.size() != expectedSize) {
    std::cerr << "Decoded pixel buffer has the wrong size\n";
    return 1;
  }
  return 0;
}
