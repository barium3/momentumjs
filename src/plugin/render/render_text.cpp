#include "render_text.h"
#include "render_core.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_GLYPH_H
#include FT_OUTLINE_H
#include FT_STROKER_H
#include FT_TYPE1_TABLES_H
#include <hb-ft.h>
#include <hb.h>

namespace momentum {

namespace {

std::recursive_mutex& GetTextRenderMutex() {
  static std::recursive_mutex mutex;
  return mutex;
}

struct FontEntry {
  std::string path;
  FT_Long faceIndex = 0;
  std::string family;
  std::string style;
  std::string postscript;
  std::string stem;
};

struct FontManager {
  FT_Library library = NULL;
  bool libraryReady = false;
  bool scanned = false;
  std::vector<FontEntry> entries;
};

FontManager& GetFontManager() {
  static FontManager manager;
  if (!manager.libraryReady) {
    manager.libraryReady = FT_Init_FreeType(&manager.library) == 0;
  }
  return manager;
}

std::string ToLowerCopy(const std::string& value) {
  std::string lowered = value;
  std::transform(
    lowered.begin(),
    lowered.end(),
    lowered.begin(),
    [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); }
  );
  return lowered;
}

std::string NormalizeSourceKind(const std::string& value) {
  return ToLowerCopy(value) == "file" ? "file" : "system";
}

bool EndsWithFontExtension(const std::filesystem::path& path) {
  const std::string extension = ToLowerCopy(path.extension().string());
  return
    extension == ".ttf" ||
    extension == ".otf" ||
    extension == ".ttc" ||
    extension == ".otc" ||
    extension == ".dfont";
}

void IndexFontFile(FontManager* manager, const std::filesystem::path& path) {
  if (!manager || !manager->libraryReady) {
    return;
  }

  FT_Face probeFace = NULL;
  if (FT_New_Face(manager->library, path.string().c_str(), 0, &probeFace) != 0 || !probeFace) {
    return;
  }

  const FT_Long faceCount = std::max<FT_Long>(1, probeFace->num_faces);
  FT_Done_Face(probeFace);

  for (FT_Long faceIndex = 0; faceIndex < faceCount; ++faceIndex) {
    FT_Face face = NULL;
    if (FT_New_Face(manager->library, path.string().c_str(), faceIndex, &face) != 0 || !face) {
      continue;
    }

    FontEntry entry;
    entry.path = path.string();
    entry.faceIndex = faceIndex;
    entry.family = face->family_name ? face->family_name : "";
    entry.style = face->style_name ? face->style_name : "";
    entry.postscript = FT_Get_Postscript_Name(face) ? FT_Get_Postscript_Name(face) : "";
    entry.stem = path.stem().string();
    manager->entries.push_back(entry);
    FT_Done_Face(face);
  }
}

void EnsureFontScan() {
  FontManager& manager = GetFontManager();
  if (manager.scanned || !manager.libraryReady) {
    return;
  }

  std::vector<std::filesystem::path> roots;
#if defined(__APPLE__)
  roots.push_back("/System/Library/Fonts");
  roots.push_back("/Library/Fonts");
  if (const char* home = std::getenv("HOME")) {
    roots.push_back(std::filesystem::path(home) / "Library/Fonts");
  }
#elif defined(_WIN32)
  roots.push_back("C:/Windows/Fonts");
#endif

  for (std::size_t i = 0; i < roots.size(); ++i) {
    const std::filesystem::path& root = roots[i];
    std::error_code ec;
    if (!std::filesystem::exists(root, ec)) {
      continue;
    }

    for (std::filesystem::recursive_directory_iterator it(root, ec), end; it != end; it.increment(ec)) {
      if (ec) {
        ec.clear();
        continue;
      }
      if (!it->is_regular_file()) {
        continue;
      }
      if (!EndsWithFontExtension(it->path())) {
        continue;
      }
      IndexFontFile(&manager, it->path());
    }
  }

  manager.scanned = true;
}

int ScoreStyleMatch(const std::string& requestedStyle, const FontEntry& entry) {
  const std::string requested = ToLowerCopy(requestedStyle);
  const std::string style = ToLowerCopy(entry.style);
  const bool wantsBold = requested.find("bold") != std::string::npos;
  const bool wantsItalic = requested.find("italic") != std::string::npos;
  const bool hasBold = style.find("bold") != std::string::npos;
  const bool hasItalic = style.find("italic") != std::string::npos || style.find("oblique") != std::string::npos;

  int score = 0;
  if (wantsBold == hasBold) {
    score += 40;
  }
  if (wantsItalic == hasItalic) {
    score += 40;
  }
  if (!wantsBold && !wantsItalic && style.find("regular") != std::string::npos) {
    score += 20;
  }
  return score;
}

const FontEntry* ResolveFontEntry(
  const std::string& requestedName,
  const std::string& requestedStyle,
  bool allowFallback
) {
  EnsureFontScan();
  FontManager& manager = GetFontManager();
  if (manager.entries.empty()) {
    return NULL;
  }

  const std::string requested = ToLowerCopy(requestedName.empty() ? "arial" : requestedName);
  const FontEntry* best = NULL;
  int bestScore = -1;

  for (std::size_t i = 0; i < manager.entries.size(); ++i) {
    const FontEntry& entry = manager.entries[i];
    int score = 0;
    if (ToLowerCopy(entry.postscript) == requested) {
      score += 120;
    }
    if (ToLowerCopy(entry.family) == requested) {
      score += 100;
    }
    if (ToLowerCopy(entry.stem) == requested) {
      score += 80;
    }
    if (ToLowerCopy(entry.family + " " + entry.style) == requested) {
      score += 110;
    }
    if (score == 0) {
      continue;
    }

    score += ScoreStyleMatch(requestedStyle, entry);
    if (score > bestScore) {
      bestScore = score;
      best = &entry;
    }
  }

  if (best) {
    return best;
  }

  if (!allowFallback) {
    return NULL;
  }

  for (std::size_t i = 0; i < manager.entries.size(); ++i) {
    const FontEntry& entry = manager.entries[i];
    if (ToLowerCopy(entry.family) == "arial" || ToLowerCopy(entry.postscript) == "arialmt") {
      return &entry;
    }
  }

  return manager.entries.empty() ? NULL : &manager.entries.front();
}

bool ResolveFontFileFace(
  FT_Library library,
  const std::string& path,
  const std::string& requestedStyle,
  FT_Long* outFaceIndex,
  std::string* outFamily,
  std::string* outStyle
) {
  if (!library || path.empty() || !outFaceIndex) {
    return false;
  }

  FT_Face probeFace = NULL;
  if (FT_New_Face(library, path.c_str(), 0, &probeFace) != 0 || !probeFace) {
    return false;
  }

  const FT_Long faceCount = std::max<FT_Long>(1, probeFace->num_faces);
  FT_Done_Face(probeFace);

  int bestScore = -1;
  FT_Long bestFaceIndex = 0;
  std::string bestFamily;
  std::string bestStyle;
  for (FT_Long faceIndex = 0; faceIndex < faceCount; ++faceIndex) {
    FT_Face face = NULL;
    if (FT_New_Face(library, path.c_str(), faceIndex, &face) != 0 || !face) {
      continue;
    }

    FontEntry entry;
    entry.path = path;
    entry.faceIndex = faceIndex;
    entry.family = face->family_name ? face->family_name : "";
    entry.style = face->style_name ? face->style_name : "";
    const int score = ScoreStyleMatch(requestedStyle, entry);
    if (score > bestScore) {
      bestScore = score;
      bestFaceIndex = faceIndex;
      bestFamily = entry.family;
      bestStyle = entry.style;
    }
    FT_Done_Face(face);
  }

  *outFaceIndex = bestFaceIndex;
  if (outFamily) {
    *outFamily = bestFamily;
  }
  if (outStyle) {
    *outStyle = bestStyle;
  }
  return true;
}

struct FaceHandle {
  FT_Face face = NULL;
  hb_font_t* hbFont = NULL;

  ~FaceHandle() {
    if (hbFont) {
      hb_font_destroy(hbFont);
    }
    if (face) {
      FT_Done_Face(face);
    }
  }
};

bool LoadFace(
  const std::string& fontName,
  const std::string& fontPath,
  const std::string& fontSourceKind,
  const std::string& textStyle,
  double textSize,
  bool allowFallback,
  FaceHandle* outFace
) {
  if (!outFace) {
    return false;
  }

  FontManager& manager = GetFontManager();
  if (!manager.libraryReady) {
    return false;
  }

  FT_Face face = NULL;
  if (NormalizeSourceKind(fontSourceKind) == "file" && !fontPath.empty()) {
    FT_Long faceIndex = 0;
    if (!ResolveFontFileFace(manager.library, fontPath, textStyle, &faceIndex, NULL, NULL)) {
      return false;
    }
    if (FT_New_Face(manager.library, fontPath.c_str(), faceIndex, &face) != 0 || !face) {
      return false;
    }
  } else {
    const FontEntry* entry = ResolveFontEntry(fontName, textStyle, allowFallback);
    if (!entry) {
      return false;
    }
    if (FT_New_Face(manager.library, entry->path.c_str(), entry->faceIndex, &face) != 0 || !face) {
      return false;
    }
  }

  const unsigned int pixelSize = static_cast<unsigned int>(std::max(1.0, std::round(textSize)));
  if (FT_Set_Pixel_Sizes(face, 0, pixelSize) != 0) {
    FT_Done_Face(face);
    return false;
  }

  hb_font_t* hbFont = hb_ft_font_create_referenced(face);
  if (!hbFont) {
    FT_Done_Face(face);
    return false;
  }

  hb_ft_font_set_funcs(hbFont);
  outFace->face = face;
  outFace->hbFont = hbFont;
  return true;
}

std::size_t Utf8CharLength(unsigned char leadByte) {
  if ((leadByte & 0x80U) == 0U) {
    return 1U;
  }
  if ((leadByte & 0xE0U) == 0xC0U) {
    return 2U;
  }
  if ((leadByte & 0xF0U) == 0xE0U) {
    return 3U;
  }
  if ((leadByte & 0xF8U) == 0xF0U) {
    return 4U;
  }
  return 1U;
}

std::vector<std::string> SplitUtf8Chars(const std::string& text) {
  std::vector<std::string> chars;
  for (std::size_t index = 0; index < text.size();) {
    const std::size_t length = std::min(Utf8CharLength(static_cast<unsigned char>(text[index])), text.size() - index);
    chars.push_back(text.substr(index, length));
    index += length;
  }
  return chars;
}

std::vector<std::string> TokenizeForWrap(const std::string& line, const std::string& wrapMode) {
  if (ToLowerCopy(wrapMode) == "char") {
    return SplitUtf8Chars(line);
  }

  std::vector<std::string> tokens;
  std::string current;
  const std::vector<std::string> chars = SplitUtf8Chars(line);
  for (std::size_t i = 0; i < chars.size(); ++i) {
    const std::string& ch = chars[i];
    if (ch == " " || ch == "\t") {
      if (!current.empty()) {
        tokens.push_back(current);
        current.clear();
      }
      tokens.push_back(ch);
      continue;
    }

    const unsigned char lead = static_cast<unsigned char>(ch[0]);
    if (lead < 0x80U) {
      current += ch;
    } else {
      if (!current.empty()) {
        tokens.push_back(current);
        current.clear();
      }
      tokens.push_back(ch);
    }
  }
  if (!current.empty()) {
    tokens.push_back(current);
  }
  return tokens;
}

struct ShapedGlyph {
  FT_UInt glyphIndex = 0;
  double x = 0.0;
  double xAdvance = 0.0;
  double xOffset = 0.0;
  double yOffset = 0.0;
};

bool ShapeTextLine(
  hb_font_t* hbFont,
  const std::string& text,
  std::vector<ShapedGlyph>* outGlyphs,
  double* outWidth
) {
  if (!hbFont || !outGlyphs || !outWidth) {
    return false;
  }

  outGlyphs->clear();
  *outWidth = 0.0;

  hb_buffer_t* buffer = hb_buffer_create();
  if (!buffer) {
    return false;
  }

  hb_buffer_add_utf8(buffer, text.c_str(), static_cast<int>(text.size()), 0, static_cast<int>(text.size()));
  hb_buffer_guess_segment_properties(buffer);
  hb_shape(hbFont, buffer, NULL, 0);

  unsigned int glyphCount = 0;
  hb_glyph_info_t* infos = hb_buffer_get_glyph_infos(buffer, &glyphCount);
  hb_glyph_position_t* positions = hb_buffer_get_glyph_positions(buffer, &glyphCount);

  double penX = 0.0;
  outGlyphs->reserve(glyphCount);
  for (unsigned int i = 0; i < glyphCount; ++i) {
    ShapedGlyph glyph;
    glyph.glyphIndex = infos[i].codepoint;
    glyph.x = penX;
    glyph.xAdvance = static_cast<double>(positions[i].x_advance) / 64.0;
    glyph.xOffset = static_cast<double>(positions[i].x_offset) / 64.0;
    glyph.yOffset = static_cast<double>(positions[i].y_offset) / 64.0;
    outGlyphs->push_back(glyph);
    penX += glyph.xAdvance;
  }

  *outWidth = penX;
  hb_buffer_destroy(buffer);
  return true;
}

std::vector<std::string> SplitLines(const std::string& text) {
  std::vector<std::string> lines;
  std::string current;
  for (std::size_t i = 0; i < text.size(); ++i) {
    const char ch = text[i];
    if (ch == '\r') {
      continue;
    }
    if (ch == '\n') {
      lines.push_back(current);
      current.clear();
      continue;
    }
    current.push_back(ch);
  }
  lines.push_back(current);
  return lines;
}

std::string TrimLeadingSpaces(const std::string& text) {
  std::size_t index = 0;
  while (index < text.size() && (text[index] == ' ' || text[index] == '\t')) {
    index += 1;
  }
  return text.substr(index);
}

std::vector<std::string> WrapLine(
  hb_font_t* hbFont,
  const std::string& line,
  const std::string& wrapMode,
  double maxWidth
) {
  if (!(maxWidth > 0.0) || !std::isfinite(maxWidth)) {
    return std::vector<std::string>(1, line);
  }

  const std::vector<std::string> tokens = TokenizeForWrap(line, wrapMode);
  std::vector<std::string> wrapped;
  std::string current;
  double currentWidth = 0.0;

  for (std::size_t i = 0; i < tokens.size(); ++i) {
    const std::string& token = tokens[i];
    double tokenWidth = 0.0;
    std::vector<ShapedGlyph> tokenGlyphs;
    ShapeTextLine(hbFont, token, &tokenGlyphs, &tokenWidth);
    const bool whitespace = token == " " || token == "\t";

    if (!current.empty() && currentWidth + tokenWidth > maxWidth) {
      wrapped.push_back(TrimLeadingSpaces(current));
      current.clear();
      currentWidth = 0.0;
    }

    if (tokenWidth > maxWidth && current.empty()) {
      if (!whitespace) {
        wrapped.push_back(TrimLeadingSpaces(token));
      }
      continue;
    }

    if (whitespace && current.empty()) {
      continue;
    }

    current += token;
    currentWidth += tokenWidth;
  }

  if (!current.empty() || wrapped.empty()) {
    wrapped.push_back(TrimLeadingSpaces(current));
  }

  return wrapped;
}

struct LayoutLine {
  std::string text;
  double width = 0.0;
  double baselineX = 0.0;
  double baselineY = 0.0;
  std::vector<ShapedGlyph> glyphs;
};

struct TextLayout {
  std::vector<LayoutLine> lines;
  TextLayoutMetrics metrics;
};

int EffectiveAlignH(int value) {
  return value;
}

int EffectiveAlignV(int value) {
  return value;
}

bool BuildTextLayout(const SceneCommand& command, TextLayout* outLayout) {
  if (!outLayout) {
    return false;
  }

  FaceHandle faceHandle;
  if (!LoadFace(
        command.fontName,
        command.fontPath,
        command.fontSourceKind,
        command.textStyle,
        command.textSize,
        true,
        &faceHandle)) {
    return false;
  }

  const double ascent = static_cast<double>(faceHandle.face->size->metrics.ascender) / 64.0;
  const double descent = std::fabs(static_cast<double>(faceHandle.face->size->metrics.descender) / 64.0);
  const double leading = command.textLeading > 0.0 ? command.textLeading : (command.textSize * 1.2);
  const double boxWidth = command.textHasWidth ? command.width.value : 0.0;
  const double boxHeight = command.textHasHeight ? command.height.value : 0.0;

  std::vector<std::string> allLines;
  const std::vector<std::string> paragraphs = SplitLines(command.text);
  for (std::size_t i = 0; i < paragraphs.size(); ++i) {
    const std::vector<std::string> wrapped = command.textHasWidth
      ? WrapLine(faceHandle.hbFont, paragraphs[i], command.textWrap, boxWidth)
      : std::vector<std::string>(1, paragraphs[i]);
    allLines.insert(allLines.end(), wrapped.begin(), wrapped.end());
  }

  outLayout->lines.clear();
  outLayout->metrics.ascent = ascent;
  outLayout->metrics.descent = descent;

  for (std::size_t i = 0; i < allLines.size(); ++i) {
    LayoutLine line;
    line.text = allLines[i];
    ShapeTextLine(faceHandle.hbFont, line.text, &line.glyphs, &line.width);
    outLayout->lines.push_back(line);
  }

  if (command.textHasHeight && leading > 0.0) {
    int maxLines = 0;
    if (!outLayout->lines.empty() && boxHeight > 0.0) {
      maxLines = 1;
    }
    if (boxHeight >= (ascent + descent)) {
      maxLines = 1;
      double consumedHeight = ascent + descent;
      while (
        maxLines < static_cast<int>(outLayout->lines.size()) &&
        consumedHeight + leading <= boxHeight + 1e-6) {
        consumedHeight += leading;
        maxLines += 1;
      }
    }
    if (static_cast<int>(outLayout->lines.size()) > maxLines) {
      outLayout->lines.resize(std::max(0, maxLines));
    }
  }

  double maxWidth = 0.0;
  for (std::size_t i = 0; i < outLayout->lines.size(); ++i) {
    maxWidth = std::max(maxWidth, outLayout->lines[i].width);
  }

  const double blockHeight = outLayout->lines.empty()
    ? 0.0
    : (ascent + descent + (static_cast<double>(outLayout->lines.size() - 1) * leading));

  outLayout->metrics.width = maxWidth;
  outLayout->metrics.height = blockHeight;

  double blockTop = command.y.value;
  if (command.textHasHeight) {
    if (EffectiveAlignV(command.textAlignV) == 2) {
      blockTop = command.y.value + std::max(0.0, (boxHeight - blockHeight) * 0.5);
    } else if (EffectiveAlignV(command.textAlignV) == 1) {
      blockTop = command.y.value + std::max(0.0, boxHeight - blockHeight);
    }
  } else {
    if (EffectiveAlignV(command.textAlignV) == 0) {
      blockTop = command.y.value;
    } else if (EffectiveAlignV(command.textAlignV) == 2) {
      blockTop = command.y.value - blockHeight * 0.5;
    } else if (EffectiveAlignV(command.textAlignV) == 1) {
      blockTop = command.y.value - blockHeight;
    } else {
      blockTop = command.y.value - ascent;
    }
  }

  for (std::size_t i = 0; i < outLayout->lines.size(); ++i) {
    LayoutLine& line = outLayout->lines[i];
    double lineX = command.x.value;
    const double availableWidth = command.textHasWidth ? boxWidth : maxWidth;
    if (EffectiveAlignH(command.textAlignH) == 2) {
      lineX = command.x.value + std::max(0.0, (availableWidth - line.width) * 0.5);
    } else if (EffectiveAlignH(command.textAlignH) == 1) {
      lineX = command.x.value + std::max(0.0, availableWidth - line.width);
    } else if (!command.textHasWidth && EffectiveAlignH(command.textAlignH) == 2) {
      lineX = command.x.value - line.width * 0.5;
    } else if (!command.textHasWidth && EffectiveAlignH(command.textAlignH) == 1) {
      lineX = command.x.value - line.width;
    }

    if (!command.textHasWidth) {
      if (EffectiveAlignH(command.textAlignH) == 2) {
        lineX = command.x.value - line.width * 0.5;
      } else if (EffectiveAlignH(command.textAlignH) == 1) {
        lineX = command.x.value - line.width;
      }
    }

    line.baselineX = lineX;
    line.baselineY = blockTop + ascent + static_cast<double>(i) * leading;
  }

  return true;
}

void BlitBitmap(
  const FT_Bitmap& bitmap,
  int dstX,
  int dstY,
  int surfaceWidth,
  int surfaceHeight,
  std::vector<unsigned char>* alpha
) {
  if (!alpha) {
    return;
  }

  for (int row = 0; row < static_cast<int>(bitmap.rows); ++row) {
    for (int col = 0; col < static_cast<int>(bitmap.width); ++col) {
      const int x = dstX + col;
      const int y = dstY + row;
      if (x < 0 || y < 0 || x >= surfaceWidth || y >= surfaceHeight) {
        continue;
      }

      const unsigned char value =
        bitmap.buffer[row * bitmap.pitch + col];
      const std::size_t index = static_cast<std::size_t>(y * surfaceWidth + x);
      (*alpha)[index] = std::max((*alpha)[index], value);
    }
  }
}

void ExpandBounds(
  double x,
  double y,
  double width,
  double height,
  double* minX,
  double* minY,
  double* maxX,
  double* maxY
) {
  *minX = std::min(*minX, x);
  *minY = std::min(*minY, y);
  *maxX = std::max(*maxX, x + width);
  *maxY = std::max(*maxY, y + height);
}

bool RasterizeGlyphRun(
  FT_Face face,
  const LayoutLine& line,
  const Transform2D& transform,
  bool wantFill,
  bool wantStroke,
  double strokeWeight,
  double minX,
  double minY,
  int surfaceWidth,
  int surfaceHeight,
  std::vector<unsigned char>* fillAlpha,
  std::vector<unsigned char>* strokeAlpha
) {
  FT_Stroker stroker = NULL;
  if (wantStroke) {
    if (FT_Stroker_New(face->glyph->library, &stroker) != 0) {
      return false;
    }
    FT_Stroker_Set(
      stroker,
      static_cast<FT_Fixed>(std::max(1.0, strokeWeight) * 32.0),
      FT_STROKER_LINECAP_ROUND,
      FT_STROKER_LINEJOIN_ROUND,
      0
    );
  }

  for (std::size_t i = 0; i < line.glyphs.size(); ++i) {
    const ShapedGlyph& shaped = line.glyphs[i];
    if (FT_Load_Glyph(face, shaped.glyphIndex, FT_LOAD_DEFAULT) != 0) {
      continue;
    }

    const double glyphBaseX = line.baselineX + shaped.x + shaped.xOffset;
    const double glyphBaseY = line.baselineY - shaped.yOffset;
    double transformedBaseX = 0.0;
    double transformedBaseY = 0.0;
    ApplyTransform(transform, glyphBaseX, glyphBaseY, &transformedBaseX, &transformedBaseY);
    FT_Matrix ftMatrix;
    ftMatrix.xx = static_cast<FT_Fixed>(std::llround(transform.a * 65536.0));
    ftMatrix.xy = static_cast<FT_Fixed>(std::llround(-transform.c * 65536.0));
    ftMatrix.yx = static_cast<FT_Fixed>(std::llround(-transform.b * 65536.0));
    ftMatrix.yy = static_cast<FT_Fixed>(std::llround(transform.d * 65536.0));
    FT_Vector ftDelta;
    ftDelta.x = static_cast<FT_Pos>(std::llround(transformedBaseX * 64.0));
    ftDelta.y = static_cast<FT_Pos>(std::llround(-transformedBaseY * 64.0));

    if (wantFill) {
      FT_Glyph fillGlyph = NULL;
      if (FT_Get_Glyph(face->glyph, &fillGlyph) == 0 && fillGlyph) {
        FT_Glyph_Transform(fillGlyph, &ftMatrix, &ftDelta);
        if (FT_Glyph_To_Bitmap(&fillGlyph, FT_RENDER_MODE_NORMAL, NULL, 1) == 0) {
          FT_BitmapGlyph bitmapGlyph = reinterpret_cast<FT_BitmapGlyph>(fillGlyph);
          const int dstX = static_cast<int>(std::floor(bitmapGlyph->left - minX));
          const int dstY = static_cast<int>(std::floor(-bitmapGlyph->top - minY));
          BlitBitmap(bitmapGlyph->bitmap, dstX, dstY, surfaceWidth, surfaceHeight, fillAlpha);
        }
        FT_Done_Glyph(fillGlyph);
      }
    }

    if (wantStroke && strokeAlpha) {
      FT_Glyph strokeGlyph = NULL;
      if (FT_Get_Glyph(face->glyph, &strokeGlyph) == 0 && strokeGlyph) {
        FT_Glyph_Transform(strokeGlyph, &ftMatrix, &ftDelta);
        if (FT_Glyph_StrokeBorder(&strokeGlyph, stroker, 0, 1) == 0 &&
            FT_Glyph_To_Bitmap(&strokeGlyph, FT_RENDER_MODE_NORMAL, NULL, 1) == 0) {
          FT_BitmapGlyph bitmapGlyph = reinterpret_cast<FT_BitmapGlyph>(strokeGlyph);
          const int dstX = static_cast<int>(std::floor(bitmapGlyph->left - minX));
          const int dstY = static_cast<int>(std::floor(-bitmapGlyph->top - minY));
          BlitBitmap(bitmapGlyph->bitmap, dstX, dstY, surfaceWidth, surfaceHeight, strokeAlpha);
        }
        FT_Done_Glyph(strokeGlyph);
      }
    }
  }

  if (stroker) {
    FT_Stroker_Done(stroker);
  }
  return true;
}

}  // namespace

bool ResolveFont(
  const std::string& fontName,
  const std::string& fontPath,
  const std::string& fontSourceKind,
  const std::string& textStyle,
  FontDescriptor* outDescriptor
) {
  std::lock_guard<std::recursive_mutex> guard(GetTextRenderMutex());
  FontManager& manager = GetFontManager();
  if (!manager.libraryReady || !outDescriptor) {
    return false;
  }

  outDescriptor->fontName = fontName;
  outDescriptor->fontPath = fontPath;
  outDescriptor->fontSourceKind = NormalizeSourceKind(fontSourceKind);
  outDescriptor->loaded = false;
  outDescriptor->loadError.clear();

  if (outDescriptor->fontSourceKind == "file") {
    FT_Long faceIndex = 0;
    std::string family;
    if (!ResolveFontFileFace(manager.library, fontPath, textStyle, &faceIndex, &family, NULL)) {
      outDescriptor->loadError = fontPath.empty() ? "Font file path is empty" : "Failed to load font file";
      return false;
    }
    outDescriptor->fontName = family.empty() ? fontName : family;
    outDescriptor->loaded = true;
    return true;
  }

  const FontEntry* entry = ResolveFontEntry(fontName, textStyle, false);
  if (!entry) {
    outDescriptor->loadError = fontName.empty() ? "Font name is empty" : "System font not found";
    return false;
  }

  outDescriptor->fontName = entry->family.empty() ? fontName : entry->family;
  outDescriptor->fontPath.clear();
  outDescriptor->fontSourceKind = "system";
  outDescriptor->loaded = true;
  return true;
}

bool MeasureTextCommand(const SceneCommand& command, TextLayoutMetrics* outMetrics) {
  std::lock_guard<std::recursive_mutex> guard(GetTextRenderMutex());
  TextLayout layout;
  if (!BuildTextLayout(command, &layout)) {
    return false;
  }
  if (outMetrics) {
    *outMetrics = layout.metrics;
  }
  return true;
}

bool RasterizeTextCommand(const SceneCommand& command, RasterizedText* outRasterized) {
  std::lock_guard<std::recursive_mutex> guard(GetTextRenderMutex());
  if (!outRasterized) {
    return false;
  }

  TextLayout layout;
  if (!BuildTextLayout(command, &layout)) {
    return false;
  }

  FaceHandle faceHandle;
  if (!LoadFace(
        command.fontName,
        command.fontPath,
        command.fontSourceKind,
        command.textStyle,
        command.textSize,
        true,
        &faceHandle)) {
    return false;
  }

  double minX = 1e9;
  double minY = 1e9;
  double maxX = -1e9;
  double maxY = -1e9;

  for (std::size_t i = 0; i < layout.lines.size(); ++i) {
    const LayoutLine& line = layout.lines[i];
    for (std::size_t g = 0; g < line.glyphs.size(); ++g) {
      const ShapedGlyph& shaped = line.glyphs[g];
      if (FT_Load_Glyph(faceHandle.face, shaped.glyphIndex, FT_LOAD_DEFAULT) != 0) {
        continue;
      }

      const double glyphBaseX = line.baselineX + shaped.x + shaped.xOffset;
      const double glyphBaseY = line.baselineY - shaped.yOffset;
      double transformedBaseX = 0.0;
      double transformedBaseY = 0.0;
      ApplyTransform(command.transform, glyphBaseX, glyphBaseY, &transformedBaseX, &transformedBaseY);
      FT_Matrix ftMatrix;
      ftMatrix.xx = static_cast<FT_Fixed>(std::llround(command.transform.a * 65536.0));
      ftMatrix.xy = static_cast<FT_Fixed>(std::llround(-command.transform.c * 65536.0));
      ftMatrix.yx = static_cast<FT_Fixed>(std::llround(-command.transform.b * 65536.0));
      ftMatrix.yy = static_cast<FT_Fixed>(std::llround(command.transform.d * 65536.0));
      FT_Vector ftDelta;
      ftDelta.x = static_cast<FT_Pos>(std::llround(transformedBaseX * 64.0));
      ftDelta.y = static_cast<FT_Pos>(std::llround(-transformedBaseY * 64.0));

      if (command.hasFill) {
        FT_Glyph fillGlyph = NULL;
        if (FT_Get_Glyph(faceHandle.face->glyph, &fillGlyph) == 0 && fillGlyph) {
          FT_Glyph_Transform(fillGlyph, &ftMatrix, &ftDelta);
          if (FT_Glyph_To_Bitmap(&fillGlyph, FT_RENDER_MODE_NORMAL, NULL, 1) == 0) {
            FT_BitmapGlyph bitmapGlyph = reinterpret_cast<FT_BitmapGlyph>(fillGlyph);
            ExpandBounds(
              bitmapGlyph->left,
              -bitmapGlyph->top,
              bitmapGlyph->bitmap.width,
              bitmapGlyph->bitmap.rows,
              &minX,
              &minY,
              &maxX,
              &maxY
            );
          }
          FT_Done_Glyph(fillGlyph);
        }
      }

      if (command.hasStroke) {
        FT_Stroker stroker = NULL;
        if (FT_Stroker_New(faceHandle.face->glyph->library, &stroker) == 0) {
          FT_Stroker_Set(
            stroker,
            static_cast<FT_Fixed>(std::max(1.0, command.strokeWeight) * 32.0),
            FT_STROKER_LINECAP_ROUND,
            FT_STROKER_LINEJOIN_ROUND,
            0
          );
          FT_Glyph strokeGlyph = NULL;
          if (FT_Get_Glyph(faceHandle.face->glyph, &strokeGlyph) == 0 && strokeGlyph) {
            FT_Glyph_Transform(strokeGlyph, &ftMatrix, &ftDelta);
            if (FT_Glyph_StrokeBorder(&strokeGlyph, stroker, 0, 1) == 0 &&
                FT_Glyph_To_Bitmap(&strokeGlyph, FT_RENDER_MODE_NORMAL, NULL, 1) == 0) {
              FT_BitmapGlyph bitmapGlyph = reinterpret_cast<FT_BitmapGlyph>(strokeGlyph);
              ExpandBounds(
                bitmapGlyph->left,
                -bitmapGlyph->top,
                bitmapGlyph->bitmap.width,
                bitmapGlyph->bitmap.rows,
                &minX,
                &minY,
                &maxX,
                &maxY
              );
            }
            FT_Done_Glyph(strokeGlyph);
          }
          FT_Stroker_Done(stroker);
        }
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    outRasterized->width = 0;
    outRasterized->height = 0;
    outRasterized->originX = command.x.value;
    outRasterized->originY = command.y.value;
    outRasterized->metrics = layout.metrics;
    outRasterized->fillAlpha.clear();
    outRasterized->strokeAlpha.clear();
    return true;
  }

  const int surfaceWidth = static_cast<int>(std::ceil(maxX - minX));
  const int surfaceHeight = static_cast<int>(std::ceil(maxY - minY));
  outRasterized->width = surfaceWidth;
  outRasterized->height = surfaceHeight;
  outRasterized->originX = minX;
  outRasterized->originY = minY;
  outRasterized->metrics = layout.metrics;
  outRasterized->fillAlpha.assign(static_cast<std::size_t>(surfaceWidth * surfaceHeight), 0);
  outRasterized->strokeAlpha.assign(static_cast<std::size_t>(surfaceWidth * surfaceHeight), 0);

  for (std::size_t i = 0; i < layout.lines.size(); ++i) {
    if (!RasterizeGlyphRun(
          faceHandle.face,
          layout.lines[i],
          command.transform,
          command.hasFill,
          command.hasStroke,
          command.strokeWeight,
          minX,
          minY,
          surfaceWidth,
          surfaceHeight,
          &outRasterized->fillAlpha,
          &outRasterized->strokeAlpha)) {
      return false;
    }
  }

  return true;
}

namespace {

struct GlyphAtlasBitmapRecord {
  FT_UInt glyphIndex = 0;
  bool stroke = false;
  int width = 0;
  int height = 0;
  int left = 0;
  int top = 0;
  int atlasX = 0;
  int atlasY = 0;
  std::vector<unsigned char> alpha;
};

std::uint64_t HashGlyphAtlasAlpha(const std::vector<unsigned char>& alpha, int width, int height) {
  std::uint64_t hash = 1469598103934665603ull;
  const std::uint64_t prime = 1099511628211ull;
  auto hashByte = [&](unsigned char value) {
    hash ^= static_cast<std::uint64_t>(value);
    hash *= prime;
  };
  for (int shift = 0; shift < 4; shift += 1) {
    hashByte(static_cast<unsigned char>((width >> (shift * 8)) & 0xFF));
    hashByte(static_cast<unsigned char>((height >> (shift * 8)) & 0xFF));
  }
  for (std::size_t index = 0; index < alpha.size(); index += 1) {
    hashByte(alpha[index]);
  }
  return hash == 0 ? 1ull : hash;
}

bool BuildGlyphAtlasImageAsset(
  int imageId,
  const char* source,
  int width,
  int height,
  const std::vector<unsigned char>& alpha,
  RuntimeImageAsset* outAsset
) {
  if (!outAsset || !source || width <= 0 || height <= 0) {
    return false;
  }
  const std::size_t pixelCount = static_cast<std::size_t>(width * height);
  if (alpha.size() < pixelCount) {
    return false;
  }

  RuntimeImageAsset asset;
  asset.id = imageId;
  asset.source = source;
  asset.width = width;
  asset.height = height;
  asset.pixelDensity = 1.0;
  asset.version = HashGlyphAtlasAlpha(alpha, width, height);
  asset.loaded = true;
  asset.pixels.resize(pixelCount);
  for (std::size_t index = 0; index < pixelCount; index += 1) {
    const unsigned char a = alpha[index];
    asset.pixels[index] = PF_Pixel{a, 255, 255, 255};
  }
  *outAsset = std::move(asset);
  return true;
}

std::uint64_t MakeGlyphAtlasRecordKey(FT_UInt glyphIndex, bool stroke) {
  return (static_cast<std::uint64_t>(glyphIndex) << 1) | static_cast<std::uint64_t>(stroke ? 1 : 0);
}

bool RasterizeSingleGlyphBitmap(
  FT_Face face,
  FT_UInt glyphIndex,
  bool stroke,
  double strokeWeight,
  GlyphAtlasBitmapRecord* outRecord
) {
  if (!face || !outRecord) {
    return false;
  }
  if (FT_Load_Glyph(face, glyphIndex, FT_LOAD_DEFAULT) != 0) {
    return false;
  }

  FT_Glyph glyph = NULL;
  if (FT_Get_Glyph(face->glyph, &glyph) != 0 || !glyph) {
    return false;
  }

  FT_Stroker stroker = NULL;
  if (stroke) {
    if (FT_Stroker_New(face->glyph->library, &stroker) != 0) {
      FT_Done_Glyph(glyph);
      return false;
    }
    FT_Stroker_Set(
      stroker,
      static_cast<FT_Fixed>(std::max(1.0, strokeWeight) * 32.0),
      FT_STROKER_LINECAP_ROUND,
      FT_STROKER_LINEJOIN_ROUND,
      0
    );
    if (FT_Glyph_StrokeBorder(&glyph, stroker, 0, 1) != 0) {
      FT_Stroker_Done(stroker);
      FT_Done_Glyph(glyph);
      return false;
    }
  }

  bool ok = false;
  if (FT_Glyph_To_Bitmap(&glyph, FT_RENDER_MODE_NORMAL, NULL, 1) == 0) {
    FT_BitmapGlyph bitmapGlyph = reinterpret_cast<FT_BitmapGlyph>(glyph);
    outRecord->glyphIndex = glyphIndex;
    outRecord->stroke = stroke;
    outRecord->width = static_cast<int>(bitmapGlyph->bitmap.width);
    outRecord->height = static_cast<int>(bitmapGlyph->bitmap.rows);
    outRecord->left = bitmapGlyph->left;
    outRecord->top = bitmapGlyph->top;
    outRecord->alpha.assign(static_cast<std::size_t>(std::max(0, outRecord->width * outRecord->height)), 0);
    const int pitch = bitmapGlyph->bitmap.pitch >= 0 ? bitmapGlyph->bitmap.pitch : -bitmapGlyph->bitmap.pitch;
    for (int row = 0; row < outRecord->height; ++row) {
      const unsigned char* srcRow = bitmapGlyph->bitmap.buffer + row * pitch;
      for (int col = 0; col < outRecord->width; ++col) {
        outRecord->alpha[static_cast<std::size_t>(row * outRecord->width + col)] = srcRow[col];
      }
    }
    ok = true;
  }

  if (stroker) {
    FT_Stroker_Done(stroker);
  }
  FT_Done_Glyph(glyph);
  return ok;
}

void PackGlyphAtlasRecords(
  std::vector<GlyphAtlasBitmapRecord*>* records,
  int* outWidth,
  int* outHeight
) {
  if (outWidth) {
    *outWidth = 0;
  }
  if (outHeight) {
    *outHeight = 0;
  }
  if (!records || records->empty()) {
    return;
  }

  std::sort(
    records->begin(),
    records->end(),
    [](const GlyphAtlasBitmapRecord* a, const GlyphAtlasBitmapRecord* b) {
      const int aMax = std::max(a ? a->width : 0, a ? a->height : 0);
      const int bMax = std::max(b ? b->width : 0, b ? b->height : 0);
      return aMax > bMax;
    }
  );

  std::size_t area = 0;
  for (std::size_t index = 0; index < records->size(); index += 1) {
    const GlyphAtlasBitmapRecord* record = (*records)[index];
    if (!record) {
      continue;
    }
    area += static_cast<std::size_t>((record->width + 1) * (record->height + 1));
  }

  const int padding = 1;
  const int targetWidth = std::max(32, std::min(1024, static_cast<int>(std::ceil(std::sqrt(static_cast<double>(std::max<std::size_t>(1, area)))))));
  int cursorX = padding;
  int cursorY = padding;
  int rowHeight = 0;
  int atlasWidth = padding;
  int atlasHeight = padding;

  for (std::size_t index = 0; index < records->size(); index += 1) {
    GlyphAtlasBitmapRecord* record = (*records)[index];
    if (!record || record->width <= 0 || record->height <= 0) {
      continue;
    }
    if (cursorX > padding && cursorX + record->width + padding > targetWidth) {
      cursorX = padding;
      cursorY += rowHeight + padding;
      rowHeight = 0;
    }
    record->atlasX = cursorX;
    record->atlasY = cursorY;
    cursorX += record->width + padding;
    rowHeight = std::max(rowHeight, record->height);
    atlasWidth = std::max(atlasWidth, record->atlasX + record->width + padding);
    atlasHeight = std::max(atlasHeight, record->atlasY + record->height + padding);
  }

  if (outWidth) {
    *outWidth = atlasWidth;
  }
  if (outHeight) {
    *outHeight = atlasHeight;
  }
}

void BlitGlyphAtlasRecord(
  const GlyphAtlasBitmapRecord& record,
  int atlasWidth,
  int atlasHeight,
  std::vector<unsigned char>* alpha
) {
  if (!alpha || atlasWidth <= 0 || atlasHeight <= 0 || record.width <= 0 || record.height <= 0) {
    return;
  }
  for (int row = 0; row < record.height; ++row) {
    for (int col = 0; col < record.width; ++col) {
      const int dstX = record.atlasX + col;
      const int dstY = record.atlasY + row;
      if (dstX < 0 || dstY < 0 || dstX >= atlasWidth || dstY >= atlasHeight) {
        continue;
      }
      (*alpha)[static_cast<std::size_t>(dstY * atlasWidth + dstX)] =
        record.alpha[static_cast<std::size_t>(row * record.width + col)];
    }
  }
}

GlyphAtlasQuad MakeGlyphAtlasQuad(
  const SceneCommand& command,
  double left,
  double top,
  double right,
  double bottom,
  int atlasX,
  int atlasY,
  int atlasWidth,
  int atlasHeight,
  int glyphWidth,
  int glyphHeight
) {
  GlyphAtlasQuad quad;
  ApplyTransform(command.transform, left, top, &quad.x1, &quad.y1);
  ApplyTransform(command.transform, right, top, &quad.x2, &quad.y2);
  ApplyTransform(command.transform, right, bottom, &quad.x3, &quad.y3);
  ApplyTransform(command.transform, left, bottom, &quad.x4, &quad.y4);

  const double atlasWidthValue = std::max(1, atlasWidth);
  const double atlasHeightValue = std::max(1, atlasHeight);
  quad.u1 = static_cast<double>(atlasX) / atlasWidthValue;
  quad.v1 = static_cast<double>(atlasY) / atlasHeightValue;
  quad.u2 = static_cast<double>(atlasX + glyphWidth) / atlasWidthValue;
  quad.v2 = static_cast<double>(atlasY) / atlasHeightValue;
  quad.u3 = static_cast<double>(atlasX + glyphWidth) / atlasWidthValue;
  quad.v3 = static_cast<double>(atlasY + glyphHeight) / atlasHeightValue;
  quad.u4 = static_cast<double>(atlasX) / atlasWidthValue;
  quad.v4 = static_cast<double>(atlasY + glyphHeight) / atlasHeightValue;
  return quad;
}

}  // namespace

bool BuildGlyphAtlasTextCommand(
  const SceneCommand& command,
  int fillImageId,
  int strokeImageId,
  GlyphAtlasTextRender* outRender
) {
  std::lock_guard<std::recursive_mutex> guard(GetTextRenderMutex());
  if (!outRender) {
    return false;
  }
  outRender->metrics = {};
  outRender->hasFillAtlas = false;
  outRender->fillAtlas = RuntimeImageAsset{};
  outRender->fillQuads.clear();
  outRender->hasStrokeAtlas = false;
  outRender->strokeAtlas = RuntimeImageAsset{};
  outRender->strokeQuads.clear();

  TextLayout layout;
  if (!BuildTextLayout(command, &layout)) {
    return false;
  }
  outRender->metrics = layout.metrics;

  FaceHandle faceHandle;
  if (!LoadFace(
        command.fontName,
        command.fontPath,
        command.fontSourceKind,
        command.textStyle,
        command.textSize,
        true,
        &faceHandle)) {
    return false;
  }

  std::unordered_map<std::uint64_t, GlyphAtlasBitmapRecord> fillRecords;
  std::unordered_map<std::uint64_t, GlyphAtlasBitmapRecord> strokeRecords;

  auto ensureRecord = [&](FT_UInt glyphIndex, bool stroke) -> GlyphAtlasBitmapRecord* {
    auto& records = stroke ? strokeRecords : fillRecords;
    const std::uint64_t key = MakeGlyphAtlasRecordKey(glyphIndex, stroke);
    auto it = records.find(key);
    if (it != records.end()) {
      return &it->second;
    }
    GlyphAtlasBitmapRecord record;
    if (!RasterizeSingleGlyphBitmap(faceHandle.face, glyphIndex, stroke, command.strokeWeight, &record)) {
      return nullptr;
    }
    auto inserted = records.emplace(key, std::move(record));
    return inserted.first != records.end() ? &inserted.first->second : nullptr;
  };

  for (std::size_t lineIndex = 0; lineIndex < layout.lines.size(); ++lineIndex) {
    const LayoutLine& line = layout.lines[lineIndex];
    for (std::size_t glyphIndex = 0; glyphIndex < line.glyphs.size(); ++glyphIndex) {
      const ShapedGlyph& glyph = line.glyphs[glyphIndex];
      if (command.hasFill && !ensureRecord(glyph.glyphIndex, false)) {
        return false;
      }
      if (command.hasStroke && !ensureRecord(glyph.glyphIndex, true)) {
        return false;
      }
    }
  }

  auto buildAtlas = [&](bool stroke, int imageId, const char* source) -> bool {
    auto& records = stroke ? strokeRecords : fillRecords;
    if (records.empty()) {
      return true;
    }

    std::vector<GlyphAtlasBitmapRecord*> packedRecords;
    packedRecords.reserve(records.size());
    for (auto& entry : records) {
      if (entry.second.width > 0 && entry.second.height > 0 && !entry.second.alpha.empty()) {
        packedRecords.push_back(&entry.second);
      }
    }
    if (packedRecords.empty()) {
      return true;
    }

    int atlasWidth = 0;
    int atlasHeight = 0;
    PackGlyphAtlasRecords(&packedRecords, &atlasWidth, &atlasHeight);
    if (atlasWidth <= 0 || atlasHeight <= 0) {
      return true;
    }

    std::vector<unsigned char> alpha(static_cast<std::size_t>(atlasWidth * atlasHeight), 0);
    for (std::size_t index = 0; index < packedRecords.size(); index += 1) {
      BlitGlyphAtlasRecord(*packedRecords[index], atlasWidth, atlasHeight, &alpha);
    }

    RuntimeImageAsset atlasAsset;
    if (!BuildGlyphAtlasImageAsset(imageId, source, atlasWidth, atlasHeight, alpha, &atlasAsset)) {
      return false;
    }

    std::vector<GlyphAtlasQuad>* outQuads = stroke ? &outRender->strokeQuads : &outRender->fillQuads;
    outQuads->clear();
    for (std::size_t lineIndex = 0; lineIndex < layout.lines.size(); ++lineIndex) {
      const LayoutLine& line = layout.lines[lineIndex];
      for (std::size_t glyphIndex = 0; glyphIndex < line.glyphs.size(); ++glyphIndex) {
        const ShapedGlyph& glyph = line.glyphs[glyphIndex];
        const std::uint64_t key = MakeGlyphAtlasRecordKey(glyph.glyphIndex, stroke);
        const auto recordIt = records.find(key);
        if (recordIt == records.end()) {
          continue;
        }
        const GlyphAtlasBitmapRecord& record = recordIt->second;
        if (record.width <= 0 || record.height <= 0) {
          continue;
        }

        const double left = line.baselineX + glyph.x + glyph.xOffset + static_cast<double>(record.left);
        const double top = line.baselineY - glyph.yOffset - static_cast<double>(record.top);
        const double right = left + static_cast<double>(record.width);
        const double bottom = top + static_cast<double>(record.height);
        outQuads->push_back(
          MakeGlyphAtlasQuad(
            command,
            left,
            top,
            right,
            bottom,
            record.atlasX,
            record.atlasY,
            atlasWidth,
            atlasHeight,
            record.width,
            record.height
          )
        );
      }
    }

    if (stroke) {
      outRender->hasStrokeAtlas = true;
      outRender->strokeAtlas = std::move(atlasAsset);
    } else {
      outRender->hasFillAtlas = true;
      outRender->fillAtlas = std::move(atlasAsset);
    }
    return true;
  };

  if (command.hasFill && !buildAtlas(false, fillImageId, "gpu_text_glyph_fill_atlas")) {
    return false;
  }
  if (command.hasStroke && !buildAtlas(true, strokeImageId, "gpu_text_glyph_stroke_atlas")) {
    return false;
  }
  return true;
}

namespace {

struct RasterPoint {
  double x = 0.0;
  double y = 0.0;
};

struct OutlineGeometry {
  TextLayoutMetrics metrics;
  std::vector<std::vector<RasterPoint>> contours;
};

bool ComputeOutlineTextGeometry(const SceneCommand& command, OutlineGeometry* outGeometry);
void ExpandContourBounds(
  const std::vector<std::vector<RasterPoint>>& contours,
  double* minX,
  double* minY,
  double* maxX,
  double* maxY
);

}  // namespace

bool ComputeTextBounds(const SceneCommand& command, TextBounds* outBounds) {
  std::lock_guard<std::recursive_mutex> guard(GetTextRenderMutex());
  if (!outBounds) {
    return false;
  }

  SceneCommand boundsCommand = command;
  boundsCommand.hasFill = true;
  boundsCommand.hasStroke = false;
  boundsCommand.fill = PF_Pixel{255, 255, 255, 255};
  boundsCommand.transform = MakeIdentityTransform();

  OutlineGeometry geometry;
  if (ComputeOutlineTextGeometry(boundsCommand, &geometry)) {
    double minX = std::numeric_limits<double>::infinity();
    double minY = std::numeric_limits<double>::infinity();
    double maxX = -std::numeric_limits<double>::infinity();
    double maxY = -std::numeric_limits<double>::infinity();
    ExpandContourBounds(geometry.contours, &minX, &minY, &maxX, &maxY);

    outBounds->metrics = geometry.metrics;
    if (minX <= maxX && minY <= maxY) {
      outBounds->x = minX;
      outBounds->y = minY;
      outBounds->width = maxX - minX;
      outBounds->height = maxY - minY;
    } else {
      outBounds->x = boundsCommand.x.value;
      outBounds->y = boundsCommand.y.value;
      outBounds->width = 0.0;
      outBounds->height = 0.0;
    }
    return true;
  }

  RasterizedText rasterized;
  if (!RasterizeTextCommand(boundsCommand, &rasterized)) {
    return false;
  }

  outBounds->x = rasterized.originX;
  outBounds->y = rasterized.originY;
  outBounds->width = static_cast<double>(rasterized.width);
  outBounds->height = static_cast<double>(rasterized.height);
  outBounds->metrics = rasterized.metrics;
  return true;
}

namespace {

struct OutlineDecomposeState {
  double baseX = 0.0;
  double baseY = 0.0;
  double toleranceSquared = 0.0;
  Transform2D transform = MakeIdentityTransform();
  std::vector<std::vector<RasterPoint>>* contours = NULL;
  std::vector<RasterPoint> currentContour;
  RasterPoint currentPoint;
  bool hasCurrentPoint = false;
};

RasterPoint TransformOutlinePoint(
  const FT_Vector& vector,
  double baseX,
  double baseY,
  const Transform2D& transform
) {
  const double localX = baseX + (static_cast<double>(vector.x) / 64.0);
  const double localY = baseY - (static_cast<double>(vector.y) / 64.0);
  RasterPoint result;
  ApplyTransform(transform, localX, localY, &result.x, &result.y);
  return result;
}

bool IsNearlySamePoint(const RasterPoint& a, const RasterPoint& b) {
  return std::fabs(a.x - b.x) <= 1e-6 && std::fabs(a.y - b.y) <= 1e-6;
}

double SquaredDistanceToSegment(const RasterPoint& point, const RasterPoint& start, const RasterPoint& end) {
  const double dx = end.x - start.x;
  const double dy = end.y - start.y;
  const double lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) {
    const double px = point.x - start.x;
    const double py = point.y - start.y;
    return px * px + py * py;
  }

  const double t = std::max(
    0.0,
    std::min(1.0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  const double projectionX = start.x + dx * t;
  const double projectionY = start.y + dy * t;
  const double offsetX = point.x - projectionX;
  const double offsetY = point.y - projectionY;
  return offsetX * offsetX + offsetY * offsetY;
}

void AppendQuadraticCurvePoints(
  const RasterPoint& start,
  const RasterPoint& control,
  const RasterPoint& end,
  double toleranceSquared,
  int depth,
  std::vector<RasterPoint>* outPoints
) {
  if (!outPoints) {
    return;
  }

  if (depth >= 12 || SquaredDistanceToSegment(control, start, end) <= toleranceSquared) {
    if (outPoints->empty() || !IsNearlySamePoint(outPoints->back(), end)) {
      outPoints->push_back(end);
    }
    return;
  }

  const RasterPoint startControl{
    (start.x + control.x) * 0.5,
    (start.y + control.y) * 0.5
  };
  const RasterPoint controlEnd{
    (control.x + end.x) * 0.5,
    (control.y + end.y) * 0.5
  };
  const RasterPoint midpoint{
    (startControl.x + controlEnd.x) * 0.5,
    (startControl.y + controlEnd.y) * 0.5
  };

  AppendQuadraticCurvePoints(start, startControl, midpoint, toleranceSquared, depth + 1, outPoints);
  AppendQuadraticCurvePoints(midpoint, controlEnd, end, toleranceSquared, depth + 1, outPoints);
}

void AppendCubicCurvePoints(
  const RasterPoint& start,
  const RasterPoint& control1,
  const RasterPoint& control2,
  const RasterPoint& end,
  double toleranceSquared,
  int depth,
  std::vector<RasterPoint>* outPoints
) {
  if (!outPoints) {
    return;
  }

  const double maxDistanceSquared = std::max(
    SquaredDistanceToSegment(control1, start, end),
    SquaredDistanceToSegment(control2, start, end)
  );
  if (depth >= 12 || maxDistanceSquared <= toleranceSquared) {
    if (outPoints->empty() || !IsNearlySamePoint(outPoints->back(), end)) {
      outPoints->push_back(end);
    }
    return;
  }

  const RasterPoint p01{(start.x + control1.x) * 0.5, (start.y + control1.y) * 0.5};
  const RasterPoint p12{(control1.x + control2.x) * 0.5, (control1.y + control2.y) * 0.5};
  const RasterPoint p23{(control2.x + end.x) * 0.5, (control2.y + end.y) * 0.5};
  const RasterPoint p012{(p01.x + p12.x) * 0.5, (p01.y + p12.y) * 0.5};
  const RasterPoint p123{(p12.x + p23.x) * 0.5, (p12.y + p23.y) * 0.5};
  const RasterPoint midpoint{(p012.x + p123.x) * 0.5, (p012.y + p123.y) * 0.5};

  AppendCubicCurvePoints(start, p01, p012, midpoint, toleranceSquared, depth + 1, outPoints);
  AppendCubicCurvePoints(midpoint, p123, p23, end, toleranceSquared, depth + 1, outPoints);
}

void FinalizeOutlineContour(OutlineDecomposeState* state) {
  if (!state || !state->contours) {
    return;
  }
  if (state->currentContour.size() >= 2 &&
      IsNearlySamePoint(state->currentContour.front(), state->currentContour.back())) {
    state->currentContour.pop_back();
  }
  if (state->currentContour.size() >= 2) {
    state->contours->push_back(state->currentContour);
  }
  state->currentContour.clear();
  state->hasCurrentPoint = false;
}

int MoveToCallback(const FT_Vector* to, void* user) {
  OutlineDecomposeState* state = reinterpret_cast<OutlineDecomposeState*>(user);
  if (!state || !to) {
    return 1;
  }

  if (!state->currentContour.empty()) {
    FinalizeOutlineContour(state);
  }

  state->currentPoint = TransformOutlinePoint(*to, state->baseX, state->baseY, state->transform);
  state->currentContour.push_back(state->currentPoint);
  state->hasCurrentPoint = true;
  return 0;
}

int LineToCallback(const FT_Vector* to, void* user) {
  OutlineDecomposeState* state = reinterpret_cast<OutlineDecomposeState*>(user);
  if (!state || !to) {
    return 1;
  }

  state->currentPoint = TransformOutlinePoint(*to, state->baseX, state->baseY, state->transform);
  if (state->currentContour.empty() || !IsNearlySamePoint(state->currentContour.back(), state->currentPoint)) {
    state->currentContour.push_back(state->currentPoint);
  }
  state->hasCurrentPoint = true;
  return 0;
}

int ConicToCallback(const FT_Vector* control, const FT_Vector* to, void* user) {
  OutlineDecomposeState* state = reinterpret_cast<OutlineDecomposeState*>(user);
  if (!state || !control || !to || !state->hasCurrentPoint) {
    return 1;
  }

  const RasterPoint controlPoint = TransformOutlinePoint(*control, state->baseX, state->baseY, state->transform);
  const RasterPoint endPoint = TransformOutlinePoint(*to, state->baseX, state->baseY, state->transform);
  AppendQuadraticCurvePoints(
    state->currentPoint,
    controlPoint,
    endPoint,
    state->toleranceSquared,
    0,
    &state->currentContour
  );
  state->currentPoint = endPoint;
  state->hasCurrentPoint = true;
  return 0;
}

int CubicToCallback(const FT_Vector* control1, const FT_Vector* control2, const FT_Vector* to, void* user) {
  OutlineDecomposeState* state = reinterpret_cast<OutlineDecomposeState*>(user);
  if (!state || !control1 || !control2 || !to || !state->hasCurrentPoint) {
    return 1;
  }

  const RasterPoint controlPoint1 = TransformOutlinePoint(*control1, state->baseX, state->baseY, state->transform);
  const RasterPoint controlPoint2 = TransformOutlinePoint(*control2, state->baseX, state->baseY, state->transform);
  const RasterPoint endPoint = TransformOutlinePoint(*to, state->baseX, state->baseY, state->transform);
  AppendCubicCurvePoints(
    state->currentPoint,
    controlPoint1,
    controlPoint2,
    endPoint,
    state->toleranceSquared,
    0,
    &state->currentContour
  );
  state->currentPoint = endPoint;
  state->hasCurrentPoint = true;
  return 0;
}

bool AppendGlyphOutlineContours(
  const FT_Outline& outline,
  double baseX,
  double baseY,
  const Transform2D& transform,
  double flattenTolerance,
  std::vector<std::vector<RasterPoint>>* outContours
) {
  if (!outContours) {
    return false;
  }

  OutlineDecomposeState state;
  state.baseX = baseX;
  state.baseY = baseY;
  state.toleranceSquared = flattenTolerance * flattenTolerance;
  state.transform = transform;
  state.contours = outContours;

  FT_Outline_Funcs callbacks;
  callbacks.move_to = MoveToCallback;
  callbacks.line_to = LineToCallback;
  callbacks.conic_to = ConicToCallback;
  callbacks.cubic_to = CubicToCallback;
  callbacks.shift = 0;
  callbacks.delta = 0;

  FT_Outline mutableOutline = outline;
  if (FT_Outline_Decompose(&mutableOutline, &callbacks, &state) != 0) {
    return false;
  }

  if (!state.currentContour.empty()) {
    FinalizeOutlineContour(&state);
  }
  return true;
}

bool ComputeOutlineTextGeometry(const SceneCommand& command, OutlineGeometry* outGeometry) {
  if (!outGeometry) {
    return false;
  }

  TextLayout layout;
  if (!BuildTextLayout(command, &layout)) {
    return false;
  }

  FaceHandle faceHandle;
  if (!LoadFace(
        command.fontName,
        command.fontPath,
        command.fontSourceKind,
        command.textStyle,
        command.textSize,
        true,
        &faceHandle)) {
    return false;
  }

  outGeometry->metrics = layout.metrics;
  outGeometry->contours.clear();
  const double flattenTolerance = std::max(0.1, command.textSize * 0.005);

  for (std::size_t i = 0; i < layout.lines.size(); ++i) {
    const LayoutLine& line = layout.lines[i];
    for (std::size_t g = 0; g < line.glyphs.size(); ++g) {
      const ShapedGlyph& shaped = line.glyphs[g];
      if (FT_Load_Glyph(faceHandle.face, shaped.glyphIndex, FT_LOAD_NO_BITMAP | FT_LOAD_NO_HINTING) != 0) {
        continue;
      }
      if (faceHandle.face->glyph->format != FT_GLYPH_FORMAT_OUTLINE ||
          faceHandle.face->glyph->outline.n_contours <= 0 ||
          faceHandle.face->glyph->outline.n_points <= 0) {
        continue;
      }

      const double glyphBaseX = line.baselineX + shaped.x + shaped.xOffset;
      const double glyphBaseY = line.baselineY - shaped.yOffset;
      AppendGlyphOutlineContours(
        faceHandle.face->glyph->outline,
        glyphBaseX,
        glyphBaseY,
        command.transform,
        flattenTolerance,
        &outGeometry->contours
      );
    }
  }

  return !outGeometry->contours.empty();
}

void ExpandContourBounds(
  const std::vector<std::vector<RasterPoint>>& contours,
  double* minX,
  double* minY,
  double* maxX,
  double* maxY
) {
  if (!minX || !minY || !maxX || !maxY) {
    return;
  }

  for (std::size_t contourIndex = 0; contourIndex < contours.size(); ++contourIndex) {
    const std::vector<RasterPoint>& contour = contours[contourIndex];
    for (std::size_t pointIndex = 0; pointIndex < contour.size(); ++pointIndex) {
      const RasterPoint& point = contour[pointIndex];
      *minX = std::min(*minX, point.x);
      *minY = std::min(*minY, point.y);
      *maxX = std::max(*maxX, point.x);
      *maxY = std::max(*maxY, point.y);
    }
  }
}

struct GridPoint {
  int x = 0;
  int y = 0;
};

struct RasterEdge {
  GridPoint from;
  GridPoint to;
};

std::uint64_t MakeGridPointKey(const GridPoint& point) {
  return
    (static_cast<std::uint64_t>(static_cast<std::uint32_t>(point.x)) << 32) |
    static_cast<std::uint32_t>(point.y);
}

bool IsSameGridPoint(const GridPoint& a, const GridPoint& b) {
  return a.x == b.x && a.y == b.y;
}

RasterPoint MakeRasterPoint(const RasterizedText& rasterized, const GridPoint& point) {
  return RasterPoint{
    rasterized.originX + static_cast<double>(point.x),
    rasterized.originY + static_cast<double>(point.y)
  };
}

bool IsFilledPixel(const std::vector<unsigned char>& alpha, int width, int height, int x, int y) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return false;
  }
  const std::size_t index = static_cast<std::size_t>(y * width + x);
  return index < alpha.size() && alpha[index] >= 128;
}

void AppendExposedCellEdges(
  const std::vector<unsigned char>& alpha,
  int width,
  int height,
  int x,
  int y,
  std::vector<RasterEdge>* outEdges
) {
  if (!outEdges || !IsFilledPixel(alpha, width, height, x, y)) {
    return;
  }

  if (!IsFilledPixel(alpha, width, height, x, y - 1)) {
    outEdges->push_back(RasterEdge{GridPoint{x, y}, GridPoint{x + 1, y}});
  }
  if (!IsFilledPixel(alpha, width, height, x + 1, y)) {
    outEdges->push_back(RasterEdge{GridPoint{x + 1, y}, GridPoint{x + 1, y + 1}});
  }
  if (!IsFilledPixel(alpha, width, height, x, y + 1)) {
    outEdges->push_back(RasterEdge{GridPoint{x + 1, y + 1}, GridPoint{x, y + 1}});
  }
  if (!IsFilledPixel(alpha, width, height, x - 1, y)) {
    outEdges->push_back(RasterEdge{GridPoint{x, y + 1}, GridPoint{x, y}});
  }
}

std::vector<std::vector<RasterPoint>> ExtractContourLoops(
  const std::vector<unsigned char>& alpha,
  int width,
  int height,
  const RasterizedText& rasterized
) {
  std::vector<RasterEdge> edges;
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      AppendExposedCellEdges(alpha, width, height, x, y, &edges);
    }
  }

  std::unordered_map<std::uint64_t, std::vector<std::size_t>> edgesByStart;
  edgesByStart.reserve(edges.size());
  for (std::size_t i = 0; i < edges.size(); ++i) {
    edgesByStart[MakeGridPointKey(edges[i].from)].push_back(i);
  }

  std::vector<unsigned char> used(edges.size(), 0);
  std::vector<std::vector<RasterPoint>> contours;
  contours.reserve(edges.size() / 4);

  for (std::size_t edgeIndex = 0; edgeIndex < edges.size(); ++edgeIndex) {
    if (used[edgeIndex] != 0) {
      continue;
    }

    std::vector<RasterPoint> contour;
    contour.reserve(64);
    const GridPoint startVertex = edges[edgeIndex].from;
    std::size_t currentEdgeIndex = edgeIndex;

    while (used[currentEdgeIndex] == 0) {
      used[currentEdgeIndex] = 1;
      const RasterEdge& edge = edges[currentEdgeIndex];
      contour.push_back(MakeRasterPoint(rasterized, edge.from));

      if (IsSameGridPoint(edge.to, startVertex)) {
        break;
      }

      const auto nextIt = edgesByStart.find(MakeGridPointKey(edge.to));
      if (nextIt == edgesByStart.end()) {
        contour.push_back(MakeRasterPoint(rasterized, edge.to));
        break;
      }

      bool foundNext = false;
      for (std::size_t candidateIndex : nextIt->second) {
        if (used[candidateIndex] == 0) {
          currentEdgeIndex = candidateIndex;
          foundNext = true;
          break;
        }
      }
      if (!foundNext) {
        contour.push_back(MakeRasterPoint(rasterized, edge.to));
        break;
      }
    }

    if (contour.size() >= 3) {
      contours.push_back(contour);
    }
  }

  return contours;
}

double NormalizeRadians(double angle) {
  while (angle > 3.14159265358979323846) {
    angle -= 6.28318530717958647692;
  }
  while (angle < -3.14159265358979323846) {
    angle += 6.28318530717958647692;
  }
  return angle;
}

std::vector<RasterPoint> SimplifyContour(const std::vector<RasterPoint>& points, double simplifyThreshold) {
  if (points.size() <= 2 || !(simplifyThreshold > 0.0)) {
    return points;
  }

  std::vector<RasterPoint> simplified;
  simplified.push_back(points.front());
  for (std::size_t i = 1; i + 1 < points.size(); ++i) {
    const RasterPoint& prev = points[i - 1];
    const RasterPoint& current = points[i];
    const RasterPoint& next = points[i + 1];
    const double inAngle = std::atan2(current.y - prev.y, current.x - prev.x);
    const double outAngle = std::atan2(next.y - current.y, next.x - current.x);
    if (std::fabs(NormalizeRadians(outAngle - inAngle)) >= simplifyThreshold) {
      simplified.push_back(current);
    }
  }
  simplified.push_back(points.back());
  return simplified.size() < 2 ? points : simplified;
}

double ComputeClosedContourLength(const std::vector<RasterPoint>& points) {
  if (points.size() <= 1) {
    return 0.0;
  }

  double length = 0.0;
  for (std::size_t i = 0; i < points.size(); ++i) {
    const RasterPoint& a = points[i];
    const RasterPoint& b = points[(i + 1) % points.size()];
    const double dx = b.x - a.x;
    const double dy = b.y - a.y;
    length += std::sqrt(dx * dx + dy * dy);
  }
  return length;
}

RasterPoint SampleClosedContourAtDistance(const std::vector<RasterPoint>& points, double distance) {
  if (points.empty()) {
    return RasterPoint();
  }
  if (points.size() == 1) {
    return points.front();
  }

  double remaining = distance;
  for (std::size_t i = 0; i < points.size(); ++i) {
    const RasterPoint& a = points[i];
    const RasterPoint& b = points[(i + 1) % points.size()];
    const double dx = b.x - a.x;
    const double dy = b.y - a.y;
    const double segmentLength = std::sqrt(dx * dx + dy * dy);
    if (segmentLength <= 1e-6) {
      continue;
    }
    if (remaining <= segmentLength || i + 1 == points.size()) {
      const double t = std::max(0.0, std::min(1.0, remaining / segmentLength));
      return RasterPoint{a.x + dx * t, a.y + dy * t};
    }
    remaining -= segmentLength;
  }

  return points.back();
}

void AppendSampledContourPoints(
  const std::vector<RasterPoint>& contour,
  double sampleFactor,
  std::vector<TextPoint>* outPoints
) {
  if (!outPoints || contour.empty()) {
    return;
  }

  const double contourLength = ComputeClosedContourLength(contour);
  if (!(contourLength > 0.0)) {
    return;
  }

  const int sampleCount = std::max(1, static_cast<int>(std::llround(contourLength * sampleFactor)));
  std::vector<RasterPoint> sampled;
  sampled.reserve(static_cast<std::size_t>(sampleCount));
  const double step = contourLength / static_cast<double>(sampleCount);
  for (int i = 0; i < sampleCount; ++i) {
    sampled.push_back(SampleClosedContourAtDistance(contour, static_cast<double>(i) * step));
  }

  for (std::size_t i = 0; i < sampled.size(); ++i) {
    const RasterPoint& prev = sampled[(i + sampled.size() - 1) % sampled.size()];
    const RasterPoint& next = sampled[(i + 1) % sampled.size()];
    outPoints->push_back(TextPoint{
      sampled[i].x,
      sampled[i].y,
      std::atan2(next.y - prev.y, next.x - prev.x) * 180.0 / 3.14159265358979323846
    });
  }
}

}  // namespace

bool ComputeTextPoints(
  const SceneCommand& command,
  double sampleFactor,
  double simplifyThreshold,
  std::vector<TextPoint>* outPoints
) {
  std::lock_guard<std::recursive_mutex> guard(GetTextRenderMutex());
  if (!outPoints) {
    return false;
  }

  outPoints->clear();

  SceneCommand pointsCommand = command;
  pointsCommand.hasFill = true;
  pointsCommand.hasStroke = false;
  pointsCommand.fill = PF_Pixel{255, 255, 255, 255};
  pointsCommand.transform = MakeIdentityTransform();

  const double effectiveSampleFactor = sampleFactor > 0.0 ? sampleFactor : 0.1;
  OutlineGeometry geometry;
  if (ComputeOutlineTextGeometry(pointsCommand, &geometry)) {
    for (std::size_t i = 0; i < geometry.contours.size(); ++i) {
      std::vector<RasterPoint> contour = SimplifyContour(geometry.contours[i], simplifyThreshold);
      AppendSampledContourPoints(contour, effectiveSampleFactor, outPoints);
    }
    return true;
  }

  RasterizedText rasterized;
  if (!RasterizeTextCommand(pointsCommand, &rasterized)) {
    return false;
  }

  if (rasterized.width <= 0 || rasterized.height <= 0 || rasterized.fillAlpha.empty()) {
    return true;
  }

  std::vector<std::vector<RasterPoint>> contours = ExtractContourLoops(
    rasterized.fillAlpha,
    rasterized.width,
    rasterized.height,
    rasterized
  );
  for (std::size_t i = 0; i < contours.size(); ++i) {
    std::vector<RasterPoint> contour = SimplifyContour(contours[i], simplifyThreshold);
    AppendSampledContourPoints(contour, effectiveSampleFactor, outPoints);
  }

  return true;
}

}  // namespace momentum
