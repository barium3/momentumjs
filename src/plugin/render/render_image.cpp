#include "render_image.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#if defined(__APPLE__)
#include <ApplicationServices/ApplicationServices.h>
#include <ImageIO/ImageIO.h>
#endif

namespace momentum {

namespace {

double ClampUnit(double value) {
  return std::max(0.0, std::min(1.0, value));
}

double ClampByte(double value) {
  return std::max(0.0, std::min(255.0, value));
}

int ClampInt(int value, int minimum, int maximum) {
  return std::max(minimum, std::min(maximum, value));
}

bool NearlyInteger(double value) {
  return std::fabs(value - std::round(value)) <= 1e-6;
}

std::size_t PixelIndex(int width, int x, int y) {
  return static_cast<std::size_t>(y * width + x);
}

PF_Pixel TransparentPixel() {
  return PF_Pixel{0, 0, 0, 0};
}

PF_Pixel MakePixel(double red, double green, double blue, double alpha) {
  return PF_Pixel{
    static_cast<A_u_char>(std::round(ClampByte(alpha))),
    static_cast<A_u_char>(std::round(ClampByte(red))),
    static_cast<A_u_char>(std::round(ClampByte(green))),
    static_cast<A_u_char>(std::round(ClampByte(blue)))
  };
}

PF_Pixel MultiplyPixelByTint(const PF_Pixel& pixel, const PF_Pixel& tint) {
  return PF_Pixel{
    static_cast<A_u_char>(std::round((static_cast<double>(pixel.alpha) * tint.alpha) / 255.0)),
    static_cast<A_u_char>(std::round((static_cast<double>(pixel.red) * tint.red) / 255.0)),
    static_cast<A_u_char>(std::round((static_cast<double>(pixel.green) * tint.green) / 255.0)),
    static_cast<A_u_char>(std::round((static_cast<double>(pixel.blue) * tint.blue) / 255.0))
  };
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

PF_Pixel BlendPixelColor(
  const PF_Pixel& destination,
  const PF_Pixel& source,
  int blendMode
) {
  const double sourceAlpha = ClampUnit(static_cast<double>(source.alpha) / 255.0);
  const double destinationAlpha = ClampUnit(static_cast<double>(destination.alpha) / 255.0);

  if (blendMode == BLEND_MODE_REPLACE) {
    return source;
  }

  const double outAlpha = sourceAlpha + destinationAlpha * (1.0 - sourceAlpha);
  if (outAlpha <= 1e-6) {
    return TransparentPixel();
  }

  const double sourceRed = static_cast<double>(source.red) / 255.0;
  const double sourceGreen = static_cast<double>(source.green) / 255.0;
  const double sourceBlue = static_cast<double>(source.blue) / 255.0;
  const double destRed = static_cast<double>(destination.red) / 255.0;
  const double destGreen = static_cast<double>(destination.green) / 255.0;
  const double destBlue = static_cast<double>(destination.blue) / 255.0;

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

  return MakePixel(outRed * 255.0, outGreen * 255.0, outBlue * 255.0, outAlpha * 255.0);
}

void NormalizeRegion(double* x, double* y, double* width, double* height) {
  if (!x || !y || !width || !height) {
    return;
  }
  if (*width < 0.0) {
    *x += *width;
    *width = -*width;
  }
  if (*height < 0.0) {
    *y += *height;
    *height = -*height;
  }
}

PF_Pixel SampleImagePixelBilinearInternal(const RuntimeImageAsset& asset, double x, double y) {
  if (!asset.loaded || asset.width <= 0 || asset.height <= 0 || asset.pixels.empty()) {
    return TransparentPixel();
  }

  x = std::max(0.0, std::min(x, static_cast<double>(asset.width - 1)));
  y = std::max(0.0, std::min(y, static_cast<double>(asset.height - 1)));

  if (NearlyInteger(x) && NearlyInteger(y)) {
    return asset.pixels[PixelIndex(
      asset.width,
      ClampInt(static_cast<int>(std::llround(x)), 0, asset.width - 1),
      ClampInt(static_cast<int>(std::llround(y)), 0, asset.height - 1)
    )];
  }

  const int x0 = ClampInt(static_cast<int>(std::floor(x)), 0, asset.width - 1);
  const int y0 = ClampInt(static_cast<int>(std::floor(y)), 0, asset.height - 1);
  const int x1 = ClampInt(x0 + 1, 0, asset.width - 1);
  const int y1 = ClampInt(y0 + 1, 0, asset.height - 1);
  const double tx = x - static_cast<double>(x0);
  const double ty = y - static_cast<double>(y0);

  const PF_Pixel p00 = asset.pixels[PixelIndex(asset.width, x0, y0)];
  const PF_Pixel p10 = asset.pixels[PixelIndex(asset.width, x1, y0)];
  const PF_Pixel p01 = asset.pixels[PixelIndex(asset.width, x0, y1)];
  const PF_Pixel p11 = asset.pixels[PixelIndex(asset.width, x1, y1)];

  const auto sampleChannel = [tx, ty](double c00, double c10, double c01, double c11) {
    const double top = c00 + (c10 - c00) * tx;
    const double bottom = c01 + (c11 - c01) * tx;
    return top + (bottom - top) * ty;
  };

  const double alpha = sampleChannel(p00.alpha, p10.alpha, p01.alpha, p11.alpha);
  if (alpha <= 1e-6) {
    return TransparentPixel();
  }

  const auto premultiply = [](const PF_Pixel& pixel, A_u_char PF_Pixel::* channel) {
    return (static_cast<double>(pixel.*channel) * static_cast<double>(pixel.alpha)) / 255.0;
  };

  const double premultipliedRed = sampleChannel(
    premultiply(p00, &PF_Pixel::red),
    premultiply(p10, &PF_Pixel::red),
    premultiply(p01, &PF_Pixel::red),
    premultiply(p11, &PF_Pixel::red)
  );
  const double premultipliedGreen = sampleChannel(
    premultiply(p00, &PF_Pixel::green),
    premultiply(p10, &PF_Pixel::green),
    premultiply(p01, &PF_Pixel::green),
    premultiply(p11, &PF_Pixel::green)
  );
  const double premultipliedBlue = sampleChannel(
    premultiply(p00, &PF_Pixel::blue),
    premultiply(p10, &PF_Pixel::blue),
    premultiply(p01, &PF_Pixel::blue),
    premultiply(p11, &PF_Pixel::blue)
  );

  return MakePixel(
    premultipliedRed * 255.0 / alpha,
    premultipliedGreen * 255.0 / alpha,
    premultipliedBlue * 255.0 / alpha,
    alpha
  );
}

void CopyRegionScaled(
  RuntimeImageAsset* destination,
  const RuntimeImageAsset& source,
  double srcX,
  double srcY,
  double srcWidth,
  double srcHeight,
  double dstX,
  double dstY,
  double dstWidth,
  double dstHeight,
  bool useBlendMode,
  int blendMode
) {
  if (!destination || !destination->loaded || !source.loaded) {
    return;
  }

  NormalizeRegion(&srcX, &srcY, &srcWidth, &srcHeight);
  NormalizeRegion(&dstX, &dstY, &dstWidth, &dstHeight);
  if (!(srcWidth > 0.0) || !(srcHeight > 0.0) || !(dstWidth > 0.0) || !(dstHeight > 0.0)) {
    return;
  }

  const int destStartX = std::max(0, static_cast<int>(std::floor(dstX)));
  const int destStartY = std::max(0, static_cast<int>(std::floor(dstY)));
  const int destEndX = std::min(destination->width, static_cast<int>(std::ceil(dstX + dstWidth)));
  const int destEndY = std::min(destination->height, static_cast<int>(std::ceil(dstY + dstHeight)));

  if (destStartX >= destEndX || destStartY >= destEndY) {
    return;
  }

  std::vector<PF_Pixel> nextPixels = destination->pixels;
  for (int y = destStartY; y < destEndY; ++y) {
    for (int x = destStartX; x < destEndX; ++x) {
      const double u = (static_cast<double>(x) + 0.5 - dstX) / dstWidth;
      const double v = (static_cast<double>(y) + 0.5 - dstY) / dstHeight;
      if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
        continue;
      }

      const double sourceX = srcX + u * srcWidth - 0.5;
      const double sourceY = srcY + v * srcHeight - 0.5;
      PF_Pixel sampled = SampleImagePixelBilinearInternal(source, sourceX, sourceY);
      const std::size_t index = PixelIndex(destination->width, x, y);
      nextPixels[index] = useBlendMode
        ? BlendPixelColor(nextPixels[index], sampled, blendMode)
        : sampled;
    }
  }

  destination->pixels.swap(nextPixels);
}

double ComputeLuma(const PF_Pixel& pixel) {
  return
    0.299 * static_cast<double>(pixel.red) +
    0.587 * static_cast<double>(pixel.green) +
    0.114 * static_cast<double>(pixel.blue);
}

#if defined(__APPLE__)
bool DecodeImageFileApple(const std::string& path, RuntimeImageAsset* outAsset) {
  if (!outAsset) {
    return false;
  }

  CFURLRef url = CFURLCreateFromFileSystemRepresentation(
    kCFAllocatorDefault,
    reinterpret_cast<const UInt8*>(path.c_str()),
    static_cast<CFIndex>(path.size()),
    false
  );
  if (!url) {
    return false;
  }

  CGImageSourceRef source = CGImageSourceCreateWithURL(url, NULL);
  CFRelease(url);
  if (!source) {
    return false;
  }

  CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
  CFRelease(source);
  if (!image) {
    return false;
  }

  const std::size_t width = CGImageGetWidth(image);
  const std::size_t height = CGImageGetHeight(image);
  if (width == 0 || height == 0) {
    CGImageRelease(image);
    return false;
  }

  std::vector<unsigned char> rgba(width * height * 4, 0);
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
    rgba.data(),
    width,
    height,
    8,
    width * 4,
    colorSpace,
    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big
  );
  CGColorSpaceRelease(colorSpace);
  if (!context) {
    CGImageRelease(image);
    return false;
  }

  CGContextClearRect(context, CGRectMake(0, 0, static_cast<CGFloat>(width), static_cast<CGFloat>(height)));
  CGContextDrawImage(context, CGRectMake(0, 0, static_cast<CGFloat>(width), static_cast<CGFloat>(height)), image);
  CGContextRelease(context);
  CGImageRelease(image);

  outAsset->width = static_cast<int>(width);
  outAsset->height = static_cast<int>(height);
  outAsset->pixels.resize(width * height);

  for (std::size_t i = 0; i < width * height; ++i) {
    const unsigned char red = rgba[i * 4 + 0];
    const unsigned char green = rgba[i * 4 + 1];
    const unsigned char blue = rgba[i * 4 + 2];
    const unsigned char alpha = rgba[i * 4 + 3];
    if (alpha == 0) {
      outAsset->pixels[i] = PF_Pixel{0, 0, 0, 0};
      continue;
    }

    const double scale = 255.0 / static_cast<double>(alpha);
    outAsset->pixels[i] = MakePixel(red * scale, green * scale, blue * scale, alpha);
  }

  outAsset->loaded = true;
  outAsset->loadError.clear();
  return true;
}
#endif

}  // namespace

bool LoadImageAssetFromFile(const std::string& path, int id, RuntimeImageAsset* outAsset) {
  if (!outAsset) {
    return false;
  }

  outAsset->id = id;
  outAsset->source = path;
  outAsset->path = path;
  outAsset->width = 0;
  outAsset->height = 0;
  outAsset->version = 1;
  outAsset->loaded = false;
  outAsset->loadError.clear();
  outAsset->pixels.clear();

#if defined(__APPLE__)
  if (DecodeImageFileApple(path, outAsset)) {
    return true;
  }
#endif

  outAsset->loadError = path.empty() ? "Image source is empty" : "Failed to load image file";
  return false;
}

RuntimeImageAsset CreateBlankImageAsset(int id, int width, int height) {
  RuntimeImageAsset asset;
  asset.id = id;
  asset.width = std::max(0, width);
  asset.height = std::max(0, height);
  asset.pixelDensity = 1.0;
  asset.version = 1;
  asset.loaded = true;
  asset.pixels.assign(static_cast<std::size_t>(asset.width * asset.height), TransparentPixel());
  return asset;
}

bool CropImageAsset(
  const RuntimeImageAsset& source,
  int id,
  int x,
  int y,
  int width,
  int height,
  RuntimeImageAsset* outAsset
) {
  if (!outAsset) {
    return false;
  }

  const int safeWidth = std::max(0, width);
  const int safeHeight = std::max(0, height);
  *outAsset = CreateBlankImageAsset(id, safeWidth, safeHeight);
  outAsset->source = source.source;
  outAsset->path = source.path;
  outAsset->pixelDensity = source.pixelDensity;
  if (!source.loaded || safeWidth <= 0 || safeHeight <= 0) {
    return true;
  }

  for (int row = 0; row < safeHeight; ++row) {
    for (int col = 0; col < safeWidth; ++col) {
      outAsset->pixels[PixelIndex(safeWidth, col, row)] = GetImagePixelNearest(source, x + col, y + row);
    }
  }
  return true;
}

bool ResizeImageAsset(RuntimeImageAsset* asset, int width, int height) {
  if (!asset || !asset->loaded) {
    return false;
  }

  int targetWidth = width;
  int targetHeight = height;
  if (targetWidth == 0 && targetHeight == 0) {
    return true;
  }
  if (targetWidth == 0 && asset->height > 0) {
    targetWidth = static_cast<int>(std::round((static_cast<double>(targetHeight) * asset->width) / asset->height));
  }
  if (targetHeight == 0 && asset->width > 0) {
    targetHeight = static_cast<int>(std::round((static_cast<double>(targetWidth) * asset->height) / asset->width));
  }

  targetWidth = std::max(1, targetWidth);
  targetHeight = std::max(1, targetHeight);
  if (targetWidth == asset->width && targetHeight == asset->height) {
    return true;
  }

  RuntimeImageAsset resized = CreateBlankImageAsset(asset->id, targetWidth, targetHeight);
  resized.source = asset->source;
  resized.path = asset->path;
  for (int y = 0; y < targetHeight; ++y) {
    for (int x = 0; x < targetWidth; ++x) {
      const double srcX = ((static_cast<double>(x) + 0.5) / targetWidth) * asset->width - 0.5;
      const double srcY = ((static_cast<double>(y) + 0.5) / targetHeight) * asset->height - 0.5;
      resized.pixels[PixelIndex(targetWidth, x, y)] = SampleImagePixelBilinearInternal(*asset, srcX, srcY);
    }
  }

  asset->width = resized.width;
  asset->height = resized.height;
  asset->pixels.swap(resized.pixels);
  asset->version += 1;
  return true;
}

bool ApplyMaskToImageAsset(RuntimeImageAsset* asset, const RuntimeImageAsset& maskAsset) {
  if (!asset || !asset->loaded || !maskAsset.loaded) {
    return false;
  }

  RuntimeImageAsset resizedMask = maskAsset;
  if (resizedMask.width != asset->width || resizedMask.height != asset->height) {
    resizedMask.id = 0;
    if (!ResizeImageAsset(&resizedMask, asset->width, asset->height)) {
      return false;
    }
  }

  for (int y = 0; y < asset->height; ++y) {
    for (int x = 0; x < asset->width; ++x) {
      const std::size_t index = PixelIndex(asset->width, x, y);
      const PF_Pixel maskPixel = resizedMask.pixels[index];
      const double maskAlpha = static_cast<double>(maskPixel.alpha) / 255.0;
      asset->pixels[index].alpha =
        static_cast<A_u_char>(std::round((static_cast<double>(asset->pixels[index].alpha) * maskAlpha)));
    }
  }
  asset->version += 1;
  return true;
}

bool CopyImageAssetRegion(
  RuntimeImageAsset* destination,
  const RuntimeImageAsset& source,
  double srcX,
  double srcY,
  double srcWidth,
  double srcHeight,
  double dstX,
  double dstY,
  double dstWidth,
  double dstHeight,
  bool useBlendMode,
  int blendMode
) {
  if (!destination || !destination->loaded || !source.loaded) {
    return false;
  }

  CopyRegionScaled(
    destination,
    source,
    srcX,
    srcY,
    srcWidth,
    srcHeight,
    dstX,
    dstY,
    dstWidth,
    dstHeight,
    useBlendMode,
    blendMode
  );
  destination->version += 1;
  return true;
}

bool ApplyFilterToImageAsset(RuntimeImageAsset* asset, const std::string& filterKind, double value) {
  if (!asset || !asset->loaded) {
    return false;
  }

  const std::string kind = filterKind;
  if (kind == "GRAY") {
    for (std::size_t i = 0; i < asset->pixels.size(); ++i) {
      const double gray = ComputeLuma(asset->pixels[i]);
      asset->pixels[i].red = static_cast<A_u_char>(std::round(gray));
      asset->pixels[i].green = static_cast<A_u_char>(std::round(gray));
      asset->pixels[i].blue = static_cast<A_u_char>(std::round(gray));
    }
    asset->version += 1;
    return true;
  }
  if (kind == "INVERT") {
    for (std::size_t i = 0; i < asset->pixels.size(); ++i) {
      asset->pixels[i].red = static_cast<A_u_char>(255 - asset->pixels[i].red);
      asset->pixels[i].green = static_cast<A_u_char>(255 - asset->pixels[i].green);
      asset->pixels[i].blue = static_cast<A_u_char>(255 - asset->pixels[i].blue);
    }
    asset->version += 1;
    return true;
  }
  if (kind == "OPAQUE") {
    for (std::size_t i = 0; i < asset->pixels.size(); ++i) {
      asset->pixels[i].alpha = 255;
    }
    asset->version += 1;
    return true;
  }
  if (kind == "THRESHOLD") {
    const double threshold = ClampUnit(value > 0.0 ? value : 0.5) * 255.0;
    for (std::size_t i = 0; i < asset->pixels.size(); ++i) {
      const double gray = ComputeLuma(asset->pixels[i]);
      const A_u_char next = gray >= threshold ? 255 : 0;
      asset->pixels[i].red = next;
      asset->pixels[i].green = next;
      asset->pixels[i].blue = next;
    }
    asset->version += 1;
    return true;
  }
  if (kind == "POSTERIZE") {
    const int levels = std::max(2, static_cast<int>(std::round(value)));
    const double step = 255.0 / static_cast<double>(levels - 1);
    for (std::size_t i = 0; i < asset->pixels.size(); ++i) {
      asset->pixels[i].red = static_cast<A_u_char>(std::round(std::round(asset->pixels[i].red / step) * step));
      asset->pixels[i].green = static_cast<A_u_char>(std::round(std::round(asset->pixels[i].green / step) * step));
      asset->pixels[i].blue = static_cast<A_u_char>(std::round(std::round(asset->pixels[i].blue / step) * step));
    }
    asset->version += 1;
    return true;
  }
  if (kind == "BLUR") {
    const int radius = std::max(1, static_cast<int>(std::round(value > 0.0 ? value : 1.0)));
    const int width = asset->width;
    const int height = asset->height;
    const int windowSize = radius * 2 + 1;
    const double invWindow = 1.0 / static_cast<double>(windowSize);
    std::vector<PF_Pixel> horizontal = asset->pixels;
    std::vector<PF_Pixel> blurred = asset->pixels;

    for (int y = 0; y < height; ++y) {
      double sumA = 0.0;
      double sumR = 0.0;
      double sumG = 0.0;
      double sumB = 0.0;
      for (int offset = -radius; offset <= radius; ++offset) {
        const int sampleX = ClampInt(offset, 0, width - 1);
        const PF_Pixel sample = asset->pixels[PixelIndex(width, sampleX, y)];
        sumA += sample.alpha;
        sumR += sample.red;
        sumG += sample.green;
        sumB += sample.blue;
      }

      for (int x = 0; x < width; ++x) {
        horizontal[PixelIndex(width, x, y)] =
          MakePixel(sumR * invWindow, sumG * invWindow, sumB * invWindow, sumA * invWindow);

        const int removeX = ClampInt(x - radius, 0, width - 1);
        const int addX = ClampInt(x + radius + 1, 0, width - 1);
        const PF_Pixel removed = asset->pixels[PixelIndex(width, removeX, y)];
        const PF_Pixel added = asset->pixels[PixelIndex(width, addX, y)];
        sumA += static_cast<double>(added.alpha) - static_cast<double>(removed.alpha);
        sumR += static_cast<double>(added.red) - static_cast<double>(removed.red);
        sumG += static_cast<double>(added.green) - static_cast<double>(removed.green);
        sumB += static_cast<double>(added.blue) - static_cast<double>(removed.blue);
      }
    }

    for (int x = 0; x < width; ++x) {
      double sumA = 0.0;
      double sumR = 0.0;
      double sumG = 0.0;
      double sumB = 0.0;
      for (int offset = -radius; offset <= radius; ++offset) {
        const int sampleY = ClampInt(offset, 0, height - 1);
        const PF_Pixel sample = horizontal[PixelIndex(width, x, sampleY)];
        sumA += sample.alpha;
        sumR += sample.red;
        sumG += sample.green;
        sumB += sample.blue;
      }

      for (int y = 0; y < height; ++y) {
        blurred[PixelIndex(width, x, y)] =
          MakePixel(sumR * invWindow, sumG * invWindow, sumB * invWindow, sumA * invWindow);

        const int removeY = ClampInt(y - radius, 0, height - 1);
        const int addY = ClampInt(y + radius + 1, 0, height - 1);
        const PF_Pixel removed = horizontal[PixelIndex(width, x, removeY)];
        const PF_Pixel added = horizontal[PixelIndex(width, x, addY)];
        sumA += static_cast<double>(added.alpha) - static_cast<double>(removed.alpha);
        sumR += static_cast<double>(added.red) - static_cast<double>(removed.red);
        sumG += static_cast<double>(added.green) - static_cast<double>(removed.green);
        sumB += static_cast<double>(added.blue) - static_cast<double>(removed.blue);
      }
    }

    asset->pixels.swap(blurred);
    asset->version += 1;
    return true;
  }
  if (kind == "ERODE" || kind == "DILATE") {
    std::vector<PF_Pixel> sourcePixels = asset->pixels;
    std::vector<PF_Pixel> next = asset->pixels;
    for (int y = 0; y < asset->height; ++y) {
      for (int x = 0; x < asset->width; ++x) {
        PF_Pixel chosen = sourcePixels[PixelIndex(asset->width, x, y)];
        double chosenLuma = ComputeLuma(chosen);
        for (int oy = -1; oy <= 1; ++oy) {
          for (int ox = -1; ox <= 1; ++ox) {
            const int sampleX = ClampInt(x + ox, 0, asset->width - 1);
            const int sampleY = ClampInt(y + oy, 0, asset->height - 1);
            const PF_Pixel sample = sourcePixels[PixelIndex(asset->width, sampleX, sampleY)];
            const double sampleLuma = ComputeLuma(sample);
            if ((kind == "ERODE" && sampleLuma < chosenLuma) ||
                (kind == "DILATE" && sampleLuma > chosenLuma)) {
              chosen = sample;
              chosenLuma = sampleLuma;
            }
          }
        }
        next[PixelIndex(asset->width, x, y)] = chosen;
      }
    }
    asset->pixels.swap(next);
    asset->version += 1;
    return true;
  }

  return false;
}

PF_Pixel GetImagePixelNearest(const RuntimeImageAsset& asset, int x, int y) {
  if (!asset.loaded || asset.width <= 0 || asset.height <= 0 || asset.pixels.empty()) {
    return TransparentPixel();
  }
  if (x < 0 || y < 0 || x >= asset.width || y >= asset.height) {
    return TransparentPixel();
  }
  return asset.pixels[PixelIndex(asset.width, x, y)];
}

PF_Pixel SampleImagePixelBilinear(const RuntimeImageAsset& asset, double x, double y) {
  return SampleImagePixelBilinearInternal(asset, x, y);
}

}  // namespace momentum
