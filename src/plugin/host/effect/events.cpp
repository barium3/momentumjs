#include "host/effect/events.h"

#include "common/math_constants.h"
#include "controllers/schema.h"
#include "host/effect/code_editor.h"
#include "host/effect/parameters.h"
#include "host/parameter_layout.h"

#include "AE_EffectUI.h"
#include "AE_EffectSuites.h"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <sstream>

namespace momentum {

namespace {

constexpr float kAngleControlRingStrokeWidth = 1.75f;
constexpr float kAngleControlIndicatorStrokeWidth =
  kAngleControlRingStrokeWidth;
constexpr float kAngleControlPadding = 6.0f;
constexpr float kAngleControlValueHeight = 18.0f;
constexpr float kAngleControlValueGap = 6.0f;
constexpr float kAngleControlFieldGap = 6.0f;
constexpr double kAngleControlScrubActivationDistance = 4.0;
constexpr double kAngleControlTurnsPixelsPerTurn = 28.0;
constexpr double kAngleControlDegreesPerPixel = 0.5;

constexpr float kColorControlSwatchHeight = 14.0f;
constexpr float kColorControlSwatchWidth = 90.0f;
constexpr float kColorControlSwatchMargin = 6.0f;

constexpr float kCodeControlMargin = 2.0f;

enum class AngleUiDragTarget {
  kNone = 0,
  kKnob = 1,
  kTurnsText = 2,
  kDegreesText = 3,
};

struct AngleUiLayout {
  DRAWBOT_RectF32 bounds = {0.0f, 0.0f, 0.0f, 0.0f};
  DRAWBOT_RectF32 valueRect = {0.0f, 0.0f, 0.0f, 0.0f};
  DRAWBOT_RectF32 turnsRect = {0.0f, 0.0f, 0.0f, 0.0f};
  DRAWBOT_RectF32 degreesRect = {0.0f, 0.0f, 0.0f, 0.0f};
  DRAWBOT_PointF32 knobCenter = {0.0f, 0.0f};
  float knobRadius = 0.0f;
};

DRAWBOT_ColorRGBA MakeCustomUiColor(
  float red,
  float green,
  float blue,
  float alpha
);
bool PointInRect(
  const DRAWBOT_RectF32& rect,
  const PF_Point& point
);
std::vector<DRAWBOT_UTF16Char> MakeDrawbotUtf16String(
  const std::string& text
);

A_intptr_t EncodeAngleDragValue(double value, bool valid) {
  if (!valid) {
    return 0;
  }
  return static_cast<A_intptr_t>(std::llround(value * 1000.0)) + 1;
}

}  // namespace

namespace {

bool TryResolveAngleUiSlot(
  const RuntimeSketchBundle& bundle,
  PF_ParamIndex paramIndex,
  int* slot
) {
  int logicalSlot = -1;
  if (!TryMapAngleParamIndexToSlot(paramIndex, &logicalSlot) ||
      ResolveControllerSlotKind(bundle, logicalSlot) !=
        RuntimeControllerSlotKind::kAngle) {
    return false;
  }
  if (slot) {
    *slot = logicalSlot;
  }
  return true;
}

bool TryResolveColorUiSlot(
  const RuntimeSketchBundle& bundle,
  PF_ParamIndex paramIndex,
  int* slot
) {
  int logicalSlot = -1;
  if (!TryMapColorParamIndexToSlot(paramIndex, &logicalSlot) ||
      ResolveControllerSlotKind(bundle, logicalSlot) !=
        RuntimeControllerSlotKind::kColor) {
    return false;
  }
  if (slot) {
    *slot = logicalSlot;
  }
  return true;
}

}  // namespace

PF_Err RegisterCustomUI(PF_InData* input) {
  if (!input || !input->inter.register_ui) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  PF_CustomUIInfo info;
  AEFX_CLR_STRUCT(info);
  // A zero-sized Comp UI does not draw an overlay. It lets us observe the
  // supported PF_Event_DRAW stream that accompanies visible Comp refreshes.
  info.events = PF_CustomEFlag_EFFECT | PF_CustomEFlag_COMP;
  return (*(input->inter.register_ui))(input->effect_ref, &info);
}

namespace {

void RequestCustomUIRefresh(
  PF_InData* input,
  PF_OutData* output,
  PF_EventExtra* event
) {
  if (!event) {
    return;
  }
  event->evt_out_flags |= PF_EO_HANDLED_EVENT;
  if (!input || !event->contextH) {
    return;
  }

  AEFX_SuiteScoper<PFAppSuite6, true> appSuite(
    input,
    kPFAppSuite,
    kPFAppSuiteVersion6,
    output
  );
  if (appSuite.get()) {
    appSuite->PF_InvalidateRect(event->contextH, NULL);
    event->evt_out_flags |= PF_EO_UPDATE_NOW;
  }
}

bool IsCodeControlEvent(PF_EventExtra* event) {
  return event &&
    event->contextH &&
    (*event->contextH)->w_type == PF_Window_EFFECT &&
    event->effect_win.index == PARAM_CODE_SNAPSHOT &&
    event->effect_win.area == PF_EA_CONTROL;
}

bool IsRestartControlEvent(PF_EventExtra* event) {
  return event &&
    event->contextH &&
    (*event->contextH)->w_type == PF_Window_EFFECT &&
    event->effect_win.index == PARAM_RESTART_CUE &&
    event->effect_win.area == PF_EA_CONTROL;
}

PF_Err DrawRestartControlUi(PF_EventExtra* event) {
  if (IsRestartControlEvent(event)) {
    // AE erases this custom control area before drawing. Leaving it empty
    // hides the popup value while preserving AE's native parameter title,
    // stopwatch, keyframe navigation, and timeline stream.
    event->evt_out_flags |= PF_EO_HANDLED_EVENT;
  }
  return PF_Err_NONE;
}

DRAWBOT_RectF32 ComputeCodeControlButtonRect(PF_EventExtra* event) {
  DRAWBOT_RectF32 rect = {0.0f, 0.0f, 0.0f, 0.0f};
  if (!event) {
    return rect;
  }
  const PF_UnionableRect frame = event->effect_win.current_frame;
  rect.left = static_cast<float>(frame.left) + kCodeControlMargin;
  rect.top = static_cast<float>(frame.top) + kCodeControlMargin;
  rect.width = std::max(
    0.0f,
    static_cast<float>(frame.right - frame.left) -
      (kCodeControlMargin * 2.0f)
  );
  rect.height = std::max(
    0.0f,
    static_cast<float>(frame.bottom - frame.top) -
      (kCodeControlMargin * 2.0f)
  );
  return rect;
}

bool HitTestCodeControl(
  PF_EventExtra* event,
  const PF_Point& mousePoint
) {
  return PointInRect(ComputeCodeControlButtonRect(event), mousePoint);
}

PF_Err DrawCodeControlUi(
  PF_InData* input,
  PF_EventExtra* event
) {
  if (!input || !IsCodeControlEvent(event)) {
    return PF_Err_NONE;
  }

  AEFX_SuiteScoper<PF_EffectCustomUISuite2> customUi(
    input,
    kPFEffectCustomUISuite,
    kPFEffectCustomUISuiteVersion2,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_DrawbotSuite1> drawbot(
    input,
    kDRAWBOT_DrawSuite,
    kDRAWBOT_DrawSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SurfaceSuite2> surface(
    input,
    kDRAWBOT_SurfaceSuite,
    kDRAWBOT_SurfaceSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SupplierSuite1> supplier(
    input,
    kDRAWBOT_SupplierSuite,
    kDRAWBOT_SupplierSuite_VersionCurrent,
    NULL
  );
  if (!customUi.get() || !drawbot.get() ||
      !surface.get() || !supplier.get()) {
    return PF_Err_NONE;
  }

  DRAWBOT_DrawRef drawRef = NULL;
  if (customUi->PF_GetDrawingReference(event->contextH, &drawRef) !=
        PF_Err_NONE ||
      !drawRef) {
    return PF_Err_NONE;
  }
  DRAWBOT_SurfaceRef surfaceRef = NULL;
  DRAWBOT_SupplierRef supplierRef = NULL;
  if (drawbot->GetSurface(drawRef, &surfaceRef) != PF_Err_NONE ||
      !surfaceRef ||
      drawbot->GetSupplier(drawRef, &supplierRef) != PF_Err_NONE ||
      !supplierRef) {
    return PF_Err_NONE;
  }

  const DRAWBOT_RectF32 button = ComputeCodeControlButtonRect(event);
  const DRAWBOT_ColorRGBA border =
    MakeCustomUiColor(0.34f, 0.34f, 0.34f, 1.0f);
  const DRAWBOT_ColorRGBA fill =
    MakeCustomUiColor(0.20f, 0.20f, 0.20f, 1.0f);
  const DRAWBOT_ColorRGBA textColor =
    MakeCustomUiColor(0.88f, 0.88f, 0.88f, 1.0f);
  surface->PaintRect(surfaceRef, &border, &button);
  DRAWBOT_RectF32 inner = {
    button.left + 1.0f,
    button.top + 1.0f,
    std::max(0.0f, button.width - 2.0f),
    std::max(0.0f, button.height - 2.0f)
  };
  surface->PaintRect(surfaceRef, &fill, &inner);

  DRAWBOT_Boolean supportsText = FALSE;
  DRAWBOT_FontRef font = NULL;
  DRAWBOT_BrushRef brush = NULL;
  if (supplier->SupportsText(supplierRef, &supportsText) == PF_Err_NONE &&
      supportsText) {
    float fontSize = 11.0f;
    supplier->GetDefaultFontSize(supplierRef, &fontSize);
    if (supplier->NewDefaultFont(supplierRef, fontSize, &font) ==
          PF_Err_NONE &&
        font &&
        supplier->NewBrush(supplierRef, &textColor, &brush) ==
          PF_Err_NONE &&
        brush) {
      const std::vector<DRAWBOT_UTF16Char> text =
        MakeDrawbotUtf16String("Edit Code...");
      const DRAWBOT_PointF32 origin = {
        button.left + (button.width * 0.5f),
        button.top + (button.height * 0.69f)
      };
      surface->DrawString(
        surfaceRef,
        brush,
        font,
        text.data(),
        &origin,
        kDRAWBOT_TextAlignment_Center,
        kDRAWBOT_TextTruncation_None,
        0.0f
      );
    }
  }
  if (brush) {
    supplier->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(brush));
  }
  if (font) {
    supplier->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(font));
  }

  event->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return PF_Err_NONE;
}

PF_Err ClickCodeControlUi(
  PF_InData* input,
  PF_ParamDef* parameters[],
  PF_EventExtra* event
) {
  if (!input || !parameters || !IsCodeControlEvent(event)) {
    return PF_Err_NONE;
  }
  const PF_Point point =
    *reinterpret_cast<PF_Point*>(&event->u.do_click.screen_point);
  if (!HitTestCodeControl(event, point)) {
    return PF_Err_NONE;
  }
  event->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return OpenCodeEditorWindow(input, parameters);
}

PF_Err AdjustCodeControlCursor(PF_EventExtra* event) {
  if (!IsCodeControlEvent(event)) {
    return PF_Err_NONE;
  }
  const PF_Point point =
    *reinterpret_cast<PF_Point*>(&event->u.adjust_cursor.screen_point);
  if (!HitTestCodeControl(event, point)) {
    return PF_Err_NONE;
  }
  event->u.adjust_cursor.set_cursor = PF_Cursor_FINGER_POINTER;
  event->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return PF_Err_NONE;
}

std::string FormatAngleTurns(int turns) {
  return std::to_string(turns);
}

std::string FormatAngleDegrees(double degrees) {
  std::ostringstream stream;
  stream << std::fixed << std::setprecision(1)
         << SanitizeAngleDegrees(degrees) << "\xC2\xB0";
  return stream.str();
}

std::string FormatSignedAngleDegrees(double degrees) {
  const double safeDegrees = SanitizeAngleDegrees(degrees);
  if (safeDegrees < 0.0) {
    return FormatAngleDegrees(safeDegrees);
  }
  return std::string("+") + FormatAngleDegrees(safeDegrees);
}

bool PointInRect(const DRAWBOT_RectF32& rect, const PF_Point& point) {
  const float x = static_cast<float>(point.h);
  const float y = static_cast<float>(point.v);
  return rect.width > 0.0f &&
    rect.height > 0.0f &&
    x >= rect.left &&
    x <= (rect.left + rect.width) &&
    y >= rect.top &&
    y <= (rect.top + rect.height);
}

bool IsColorControllerArea(PF_EventExtra* event) {
  if (!event || !event->contextH ||
      (*event->contextH)->w_type != PF_Window_EFFECT) {
    return false;
  }
  return event->effect_win.area == PF_EA_PARAM_TITLE ||
    event->effect_win.area == PF_EA_CONTROL;
}

PF_UnionableRect ResolveColorControllerFrame(PF_EventExtra* event) {
  PF_UnionableRect frame{};
  if (!event) {
    return frame;
  }

  const PF_UnionableRect currentFrame = event->effect_win.current_frame;
  const PF_UnionableRect titleFrame = event->effect_win.param_title_frame;
  const A_long currentWidth = currentFrame.right - currentFrame.left;
  const A_long currentHeight = currentFrame.bottom - currentFrame.top;
  const A_long titleWidth = titleFrame.right - titleFrame.left;
  const A_long titleHeight = titleFrame.bottom - titleFrame.top;

  if (event->effect_win.area == PF_EA_PARAM_TITLE &&
      titleWidth > 0 && titleHeight > 0) {
    return titleFrame;
  }
  if (currentWidth > 0 && currentHeight > 0) {
    return currentFrame;
  }
  if (titleWidth > 0 && titleHeight > 0) {
    return titleFrame;
  }
  return currentFrame;
}

DRAWBOT_RectF32 ComputeColorSwatchRect(PF_EventExtra* event) {
  DRAWBOT_RectF32 swatchRect = {0.0f, 0.0f, 0.0f, 0.0f};
  if (!event) {
    return swatchRect;
  }

  const PF_UnionableRect frame = ResolveColorControllerFrame(event);
  const float left = static_cast<float>(frame.left);
  const float top = static_cast<float>(frame.top);
  const float width =
    std::max(0.0f, static_cast<float>(frame.right - frame.left));
  const float height =
    std::max(0.0f, static_cast<float>(frame.bottom - frame.top));
  if (width <= 0.0f || height <= 0.0f) {
    return swatchRect;
  }

  const float swatchHeight = std::max(
    10.0f,
    std::min(kColorControlSwatchHeight, height - 4.0f)
  );
  const float swatchWidth = std::max(
    swatchHeight + 8.0f,
    std::min(
      kColorControlSwatchWidth,
      std::max(10.0f, width - (kColorControlSwatchMargin * 2.0f))
    )
  );
  const float right = left + width - kColorControlSwatchMargin;
  const float swatchLeft = std::max(left + 1.0f, right - swatchWidth);
  const float swatchTop =
    top + std::max(1.0f, (height - swatchHeight) * 0.5f);
  swatchRect.left = swatchLeft;
  swatchRect.top = swatchTop;
  swatchRect.width = std::max(
    0.0f,
    std::min(swatchWidth, (left + width) - swatchLeft - 1.0f)
  );
  swatchRect.height = std::max(
    0.0f,
    std::min(swatchHeight, (top + height) - swatchTop - 1.0f)
  );
  return swatchRect;
}

bool HitTestColorSwatch(
  PF_EventExtra* event,
  const PF_Point& point
) {
  const DRAWBOT_RectF32 swatchRect = ComputeColorSwatchRect(event);
  if (swatchRect.width <= 0.0f || swatchRect.height <= 0.0f) {
    return false;
  }

  const float mouseX = static_cast<float>(point.h);
  const float mouseY = static_cast<float>(point.v);
  return mouseX >= swatchRect.left &&
    mouseX <= (swatchRect.left + swatchRect.width) &&
    mouseY >= swatchRect.top &&
    mouseY <= (swatchRect.top + swatchRect.height);
}

AngleUiLayout ComputeAngleUiLayout(const PF_UnionableRect& frame) {
  AngleUiLayout layout;
  const float left = static_cast<float>(frame.left) + 0.5f;
  const float top = static_cast<float>(frame.top) + 0.5f;
  const float width =
    std::max(0.0f, static_cast<float>(frame.right - frame.left));
  const float height =
    std::max(0.0f, static_cast<float>(frame.bottom - frame.top));
  layout.bounds = {left, top, width, height};
  if (width <= 0.0f || height <= 0.0f) {
    return layout;
  }

  const float valueHeight = std::max(
    16.0f,
    std::min(
      kAngleControlValueHeight,
      height - (kAngleControlPadding * 2.0f)
    )
  );
  const float knobDiameter = std::max(
    20.0f,
    std::min(
      width - (kAngleControlPadding * 2.0f),
      height - (kAngleControlPadding * 2.0f) -
        valueHeight - kAngleControlValueGap
    )
  );
  layout.valueRect = {
    left + kAngleControlPadding,
    top + kAngleControlPadding,
    std::max(24.0f, width - (kAngleControlPadding * 2.0f)),
    valueHeight
  };

  const float turnsWidth =
    std::max(20.0f, std::min(32.0f, layout.valueRect.width * 0.24f));
  const float degreesWidth =
    std::max(40.0f, std::min(60.0f, layout.valueRect.width * 0.46f));
  const float totalTextWidth = std::min(
    layout.valueRect.width,
    turnsWidth + kAngleControlFieldGap + degreesWidth
  );
  const float textLeft = layout.valueRect.left +
    std::max(0.0f, (layout.valueRect.width - totalTextWidth) * 0.5f);
  layout.turnsRect = {
    textLeft,
    layout.valueRect.top,
    turnsWidth,
    layout.valueRect.height
  };
  layout.degreesRect = {
    layout.turnsRect.left + layout.turnsRect.width + kAngleControlFieldGap,
    layout.valueRect.top,
    std::max(
      24.0f,
      std::min(
        degreesWidth,
        (layout.valueRect.left + layout.valueRect.width) -
          (layout.turnsRect.left + layout.turnsRect.width +
            kAngleControlFieldGap)
      )
    ),
    layout.valueRect.height
  };

  const float knobTop =
    layout.valueRect.top + layout.valueRect.height + kAngleControlValueGap;
  layout.knobRadius = std::max(9.0f, (knobDiameter * 0.5f) - 1.0f);
  layout.knobCenter.x = left + (width * 0.5f);
  layout.knobCenter.y = knobTop + (knobDiameter * 0.5f);
  return layout;
}

bool TryComputePointerDegrees(
  const AngleUiLayout& layout,
  const PF_Point& point,
  double* degrees
) {
  if (!degrees || layout.knobRadius <= 0.0f) {
    return false;
  }
  const double dx =
    static_cast<double>(point.h) - static_cast<double>(layout.knobCenter.x);
  const double dy =
    static_cast<double>(point.v) - static_cast<double>(layout.knobCenter.y);
  if (std::fabs(dx) < 1e-6 && std::fabs(dy) < 1e-6) {
    return false;
  }
  *degrees = WrapAngleDegrees(
    (std::atan2(dy, dx) * (180.0 / kPi)) + 90.0
  );
  return true;
}

AngleUiDragTarget ResolveAngleHitTarget(
  const AngleUiLayout& layout,
  const PF_Point& point
) {
  if (PointInRect(layout.turnsRect, point)) {
    return AngleUiDragTarget::kTurnsText;
  }
  if (PointInRect(layout.degreesRect, point)) {
    return AngleUiDragTarget::kDegreesText;
  }

  const double dx =
    static_cast<double>(point.h) - static_cast<double>(layout.knobCenter.x);
  const double dy =
    static_cast<double>(point.v) - static_cast<double>(layout.knobCenter.y);
  const double distanceSquared = (dx * dx) + (dy * dy);
  const double hitRadius = static_cast<double>(layout.knobRadius) + 8.0;
  return distanceSquared <= (hitRadius * hitRadius)
    ? AngleUiDragTarget::kKnob
    : AngleUiDragTarget::kNone;
}

std::vector<DRAWBOT_UTF16Char> MakeDrawbotUtf16String(
  const std::string& text
) {
  std::vector<DRAWBOT_UTF16Char> utf16;
  utf16.reserve(text.size() + 1);
  for (std::size_t index = 0; index < text.size(); ++index) {
    const unsigned char byte = static_cast<unsigned char>(text[index]);
    if (byte == 0xC2 && index + 1 < text.size() &&
        static_cast<unsigned char>(text[index + 1]) == 0xB0) {
      utf16.push_back(static_cast<DRAWBOT_UTF16Char>(0x00B0));
      index += 1;
    } else {
      utf16.push_back(static_cast<DRAWBOT_UTF16Char>(byte));
    }
  }
  utf16.push_back(0);
  return utf16;
}

bool DecodeAngleDragValue(A_intptr_t encoded, double* value) {
  if (encoded == 0 || !value) {
    return false;
  }
  *value = static_cast<double>(encoded - 1) / 1000.0;
  return true;
}

AngleUiDragTarget DecodeAngleDragTarget(A_intptr_t encoded) {
  switch (static_cast<int>(encoded)) {
    case 1:
      return AngleUiDragTarget::kKnob;
    case 2:
      return AngleUiDragTarget::kTurnsText;
    case 3:
      return AngleUiDragTarget::kDegreesText;
    default:
      return AngleUiDragTarget::kNone;
  }
}

void ClearAngleDrag(PF_EventExtra* event) {
  if (!event) {
    return;
  }
  event->u.do_click.send_drag = FALSE;
  event->u.do_click.continue_refcon[0] = 0;
  event->u.do_click.continue_refcon[1] = 0;
  event->u.do_click.continue_refcon[2] = 0;
  event->u.do_click.continue_refcon[3] = 0;
}

void UpdateAngleDrag(
  PF_EventExtra* event,
  int slot,
  AngleUiDragTarget target,
  double trackedValue,
  bool hasTrackedValue,
  double anchorDegrees,
  bool hasAnchorDegrees,
  bool isDragCallback
) {
  if (!event) {
    return;
  }
  if (isDragCallback && event->u.do_click.last_time) {
    ClearAngleDrag(event);
    return;
  }
  event->u.do_click.send_drag = TRUE;
  event->u.do_click.continue_refcon[0] = slot + 1;
  event->u.do_click.continue_refcon[1] = static_cast<A_intptr_t>(target);
  event->u.do_click.continue_refcon[2] =
    EncodeAngleDragValue(trackedValue, hasTrackedValue);
  event->u.do_click.continue_refcon[3] =
    EncodeAngleDragValue(anchorDegrees, hasAnchorDegrees);
}

DRAWBOT_ColorRGBA MakeCustomUiColor(
  float red,
  float green,
  float blue,
  float alpha
) {
  DRAWBOT_ColorRGBA color{};
  color.red = red;
  color.green = green;
  color.blue = blue;
  color.alpha = alpha;
  return color;
}

PF_Err DrawAngleControllerUi(
  PF_InData* in_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!in_data || !params || !extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if ((*extra->contextH)->w_type != PF_Window_EFFECT ||
      extra->effect_win.area != PF_EA_CONTROL) {
    return PF_Err_NONE;
  }

  const RuntimeSketchBundle bundle =
    ReadEffectRuntimeSketchBundle(in_data, params);
  int slot = -1;
  if (!TryResolveAngleUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }

  PF_ParamDef* angleParam =
    params[ControllerAngleValueParamIndex(slot)];
  if (!angleParam) {
    return PF_Err_NONE;
  }

  AEFX_SuiteScoper<PF_EffectCustomUISuite2> customUiSuite(
    in_data,
    kPFEffectCustomUISuite,
    kPFEffectCustomUISuiteVersion2,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_DrawbotSuite1> drawbotSuite(
    in_data,
    kDRAWBOT_DrawSuite,
    kDRAWBOT_DrawSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SurfaceSuite2> surfaceSuite(
    in_data,
    kDRAWBOT_SurfaceSuite,
    kDRAWBOT_SurfaceSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SupplierSuite1> supplierSuite(
    in_data,
    kDRAWBOT_SupplierSuite,
    kDRAWBOT_SupplierSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_PathSuite1> pathSuite(
    in_data,
    kDRAWBOT_PathSuite,
    kDRAWBOT_PathSuite_VersionCurrent,
    NULL
  );
  if (!customUiSuite.get() || !drawbotSuite.get() || !surfaceSuite.get() ||
      !supplierSuite.get() || !pathSuite.get()) {
    return PF_Err_NONE;
  }

  DRAWBOT_DrawRef drawRef = NULL;
  PF_Err err =
    customUiSuite->PF_GetDrawingReference(extra->contextH, &drawRef);
  if (err != PF_Err_NONE || !drawRef) {
    return PF_Err_NONE;
  }

  DRAWBOT_SurfaceRef surfaceRef = NULL;
  DRAWBOT_SupplierRef supplierRef = NULL;
  err = drawbotSuite->GetSurface(drawRef, &surfaceRef);
  if (err != PF_Err_NONE || !surfaceRef) {
    return PF_Err_NONE;
  }
  err = drawbotSuite->GetSupplier(drawRef, &supplierRef);
  if (err != PF_Err_NONE || !supplierRef) {
    return PF_Err_NONE;
  }

  const AngleUiLayout layout =
    ComputeAngleUiLayout(extra->effect_win.current_frame);
  const double degrees = static_cast<double>(angleParam->u.fs_d.value);
  int turns = 0;
  double cycleDegrees = 0.0;
  SplitAngleDegrees(degrees, &turns, &cycleDegrees);
  const std::string turnsDisplayText = FormatAngleTurns(turns);
  const std::string degreesDisplayText =
    FormatSignedAngleDegrees(cycleDegrees);
  const double wrappedDegrees = WrapAngleDegrees(degrees);
  const double radians = (wrappedDegrees - 90.0) * (kPi / 180.0);
  const float indicatorRadius =
    std::max(0.0f, layout.knobRadius -
      (kAngleControlRingStrokeWidth * 0.5f));
  const DRAWBOT_PointF32 indicatorEnd = {
    layout.knobCenter.x +
      static_cast<float>(std::cos(radians) * indicatorRadius),
    layout.knobCenter.y +
      static_cast<float>(std::sin(radians) * indicatorRadius)
  };

  const DRAWBOT_ColorRGBA ringColor =
    MakeCustomUiColor(0.72f, 0.72f, 0.72f, 1.0f);
  const DRAWBOT_ColorRGBA indicatorColor =
    MakeCustomUiColor(0.90f, 0.90f, 0.90f, 1.0f);
  const DRAWBOT_ColorRGBA valueColor =
    MakeCustomUiColor(0.31f, 0.60f, 0.98f, 1.0f);
  const DRAWBOT_ColorRGBA xColor =
    MakeCustomUiColor(0.92f, 0.92f, 0.92f, 1.0f);

  DRAWBOT_PenRef ringPen = NULL;
  DRAWBOT_PenRef indicatorPen = NULL;
  DRAWBOT_PathRef ringPath = NULL;
  DRAWBOT_PathRef indicatorPath = NULL;
  DRAWBOT_BrushRef valueBrush = NULL;
  DRAWBOT_BrushRef xBrush = NULL;
  DRAWBOT_FontRef valueFont = NULL;

  err = supplierSuite->NewPen(
    supplierRef,
    &ringColor,
    kAngleControlRingStrokeWidth,
    &ringPen
  );
  if (err != PF_Err_NONE || !ringPen) {
    return PF_Err_NONE;
  }
  err = supplierSuite->NewPen(
    supplierRef,
    &indicatorColor,
    kAngleControlIndicatorStrokeWidth,
    &indicatorPen
  );
  if (err != PF_Err_NONE || !indicatorPen) {
    supplierSuite->ReleaseObject(
      reinterpret_cast<DRAWBOT_ObjectRef>(ringPen)
    );
    return PF_Err_NONE;
  }
  err = supplierSuite->NewPath(supplierRef, &ringPath);
  if (err != PF_Err_NONE || !ringPath) {
    supplierSuite->ReleaseObject(
      reinterpret_cast<DRAWBOT_ObjectRef>(indicatorPen)
    );
    supplierSuite->ReleaseObject(
      reinterpret_cast<DRAWBOT_ObjectRef>(ringPen)
    );
    return PF_Err_NONE;
  }
  err = supplierSuite->NewPath(supplierRef, &indicatorPath);
  if (err != PF_Err_NONE || !indicatorPath) {
    supplierSuite->ReleaseObject(
      reinterpret_cast<DRAWBOT_ObjectRef>(ringPath)
    );
    supplierSuite->ReleaseObject(
      reinterpret_cast<DRAWBOT_ObjectRef>(indicatorPen)
    );
    supplierSuite->ReleaseObject(
      reinterpret_cast<DRAWBOT_ObjectRef>(ringPen)
    );
    return PF_Err_NONE;
  }

  pathSuite->AddArc(
    ringPath,
    &layout.knobCenter,
    layout.knobRadius,
    0.0f,
    360.0f
  );
  pathSuite->MoveTo(
    indicatorPath,
    layout.knobCenter.x,
    layout.knobCenter.y
  );
  pathSuite->LineTo(indicatorPath, indicatorEnd.x, indicatorEnd.y);
  surfaceSuite->StrokePath(surfaceRef, ringPen, ringPath);
  surfaceSuite->StrokePath(surfaceRef, indicatorPen, indicatorPath);

  const float centerDotSize = kAngleControlIndicatorStrokeWidth;
  DRAWBOT_RectF32 centerRect = {
    layout.knobCenter.x - (centerDotSize * 0.5f),
    layout.knobCenter.y - (centerDotSize * 0.5f),
    centerDotSize,
    centerDotSize
  };
  surfaceSuite->PaintRect(surfaceRef, &indicatorColor, &centerRect);

  DRAWBOT_Boolean supportsText = FALSE;
  if (supplierSuite->SupportsText(supplierRef, &supportsText) ==
        PF_Err_NONE &&
      supportsText) {
    float defaultFontSize = 11.0f;
    if (supplierSuite->GetDefaultFontSize(
          supplierRef,
          &defaultFontSize
        ) == PF_Err_NONE &&
        supplierSuite->NewDefaultFont(
          supplierRef,
          defaultFontSize * 0.95f,
          &valueFont
        ) == PF_Err_NONE &&
        valueFont &&
        supplierSuite->NewBrush(
          supplierRef,
          &valueColor,
          &valueBrush
        ) == PF_Err_NONE &&
        valueBrush &&
        supplierSuite->NewBrush(
          supplierRef,
          &xColor,
          &xBrush
        ) == PF_Err_NONE &&
        xBrush) {
      const std::vector<DRAWBOT_UTF16Char> turnsText =
        MakeDrawbotUtf16String(turnsDisplayText);
      const std::vector<DRAWBOT_UTF16Char> xText =
        MakeDrawbotUtf16String("x");
      const std::vector<DRAWBOT_UTF16Char> degreesText =
        MakeDrawbotUtf16String(degreesDisplayText);
      const DRAWBOT_PointF32 turnsOrigin = {
        layout.turnsRect.left + layout.turnsRect.width,
        layout.valueRect.top + (layout.valueRect.height * 0.68f)
      };
      const DRAWBOT_PointF32 xOrigin = {
        layout.turnsRect.left + layout.turnsRect.width + 1.0f,
        layout.valueRect.top + (layout.valueRect.height * 0.68f)
      };
      const DRAWBOT_PointF32 degreesOrigin = {
        layout.degreesRect.left,
        layout.valueRect.top + (layout.valueRect.height * 0.68f)
      };
      surfaceSuite->DrawString(
        surfaceRef,
        valueBrush,
        valueFont,
        turnsText.data(),
        &turnsOrigin,
        kDRAWBOT_TextAlignment_Right,
        kDRAWBOT_TextTruncation_None,
        0.0f
      );
      surfaceSuite->DrawString(
        surfaceRef,
        xBrush,
        valueFont,
        xText.data(),
        &xOrigin,
        kDRAWBOT_TextAlignment_Left,
        kDRAWBOT_TextTruncation_None,
        0.0f
      );
      surfaceSuite->DrawString(
        surfaceRef,
        valueBrush,
        valueFont,
        degreesText.data(),
        &degreesOrigin,
        kDRAWBOT_TextAlignment_Left,
        kDRAWBOT_TextTruncation_None,
        0.0f
      );
    }
  }

  if (valueBrush) {
    supplierSuite->ReleaseObject(
      reinterpret_cast<DRAWBOT_ObjectRef>(valueBrush)
    );
  }
  if (xBrush) {
    supplierSuite->ReleaseObject(
      reinterpret_cast<DRAWBOT_ObjectRef>(xBrush)
    );
  }
  if (valueFont) {
    supplierSuite->ReleaseObject(
      reinterpret_cast<DRAWBOT_ObjectRef>(valueFont)
    );
  }
  supplierSuite->ReleaseObject(
    reinterpret_cast<DRAWBOT_ObjectRef>(indicatorPath)
  );
  supplierSuite->ReleaseObject(
    reinterpret_cast<DRAWBOT_ObjectRef>(ringPath)
  );
  supplierSuite->ReleaseObject(
    reinterpret_cast<DRAWBOT_ObjectRef>(indicatorPen)
  );
  supplierSuite->ReleaseObject(
    reinterpret_cast<DRAWBOT_ObjectRef>(ringPen)
  );

  extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return PF_Err_NONE;
}

PF_Err DrawColorControllerUi(
  PF_InData* in_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!in_data || !params || !extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if (!IsColorControllerArea(extra)) {
    return PF_Err_NONE;
  }

  const RuntimeSketchBundle bundle =
    ReadEffectRuntimeSketchBundle(in_data, params);
  int slot = -1;
  if (!TryResolveColorUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }

  PF_ParamDef* colorParam =
    params[ControllerColorParamIndex(slot)];
  if (!colorParam) {
    return PF_Err_NONE;
  }
  const ControllerColorValue fallback =
    ResolveColorControllerSpecWithDefaults(bundle, slot).defaultValue;
  const ControllerColorValue color =
    ReadColorControllerParam(in_data, colorParam, fallback);

  AEFX_SuiteScoper<PF_EffectCustomUISuite2> customUiSuite(
    in_data,
    kPFEffectCustomUISuite,
    kPFEffectCustomUISuiteVersion2,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_DrawbotSuite1> drawbotSuite(
    in_data,
    kDRAWBOT_DrawSuite,
    kDRAWBOT_DrawSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SurfaceSuite2> surfaceSuite(
    in_data,
    kDRAWBOT_SurfaceSuite,
    kDRAWBOT_SurfaceSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SupplierSuite1> supplierSuite(
    in_data,
    kDRAWBOT_SupplierSuite,
    kDRAWBOT_SupplierSuite_VersionCurrent,
    NULL
  );
  if (!customUiSuite.get() || !drawbotSuite.get() ||
      !surfaceSuite.get() || !supplierSuite.get()) {
    return PF_Err_NONE;
  }

  DRAWBOT_DrawRef drawRef = NULL;
  PF_Err err =
    customUiSuite->PF_GetDrawingReference(extra->contextH, &drawRef);
  if (err != PF_Err_NONE || !drawRef) {
    return PF_Err_NONE;
  }

  DRAWBOT_SurfaceRef surfaceRef = NULL;
  DRAWBOT_SupplierRef supplierRef = NULL;
  err = drawbotSuite->GetSurface(drawRef, &surfaceRef);
  if (err != PF_Err_NONE || !surfaceRef) {
    return PF_Err_NONE;
  }
  err = drawbotSuite->GetSupplier(drawRef, &supplierRef);
  if (err != PF_Err_NONE || !supplierRef) {
    return PF_Err_NONE;
  }

  DRAWBOT_RectF32 swatchRect = ComputeColorSwatchRect(extra);
  if (swatchRect.width <= 0.0f || swatchRect.height <= 0.0f) {
    return PF_Err_NONE;
  }
  DRAWBOT_RectF32 innerRect = {
    swatchRect.left + 1.0f,
    swatchRect.top + 1.0f,
    std::max(0.0f, swatchRect.width - 2.0f),
    std::max(0.0f, swatchRect.height - 2.0f)
  };

  const DRAWBOT_ColorRGBA borderColor =
    MakeCustomUiColor(0.36f, 0.36f, 0.36f, 1.0f);
  const DRAWBOT_ColorRGBA fillColor = MakeCustomUiColor(
    static_cast<float>(ClampColorComponent(color.r, 1.0)),
    static_cast<float>(ClampColorComponent(color.g, 1.0)),
    static_cast<float>(ClampColorComponent(color.b, 1.0)),
    1.0f
  );
  const DRAWBOT_ColorRGBA alphaHintColor =
    MakeCustomUiColor(0.20f, 0.20f, 0.20f, 1.0f);

  surfaceSuite->PaintRect(surfaceRef, &borderColor, &swatchRect);
  surfaceSuite->PaintRect(surfaceRef, &alphaHintColor, &innerRect);
  surfaceSuite->PaintRect(surfaceRef, &fillColor, &innerRect);

  extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return PF_Err_NONE;
}

PF_Err ClickColorControllerUi(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!in_data || !out_data || !params || !extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if (!IsColorControllerArea(extra)) {
    return PF_Err_NONE;
  }

  const PF_Point mousePoint =
    *reinterpret_cast<PF_Point*>(&extra->u.do_click.screen_point);
  if (!HitTestColorSwatch(extra, mousePoint)) {
    return PF_Err_NONE;
  }

  const RuntimeSketchBundle bundle =
    ReadEffectRuntimeSketchBundle(in_data, params);
  int slot = -1;
  if (!TryResolveColorUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }

  PF_ParamDef* colorParam =
    params[ControllerColorValueParamIndex(slot)];
  if (!colorParam) {
    return PF_Err_NONE;
  }
  const ControllerColorValue fallback =
    ResolveColorControllerSpecWithDefaults(bundle, slot).defaultValue;
  const ControllerColorValue currentColor =
    ReadColorControllerParam(in_data, colorParam, fallback);
  ControllerColorValue nextColor = currentColor;
  const PF_Err colorPickErr = PromptForColorControllerValue(
    in_data,
    out_data,
    currentColor,
    &nextColor
  );
  if (colorPickErr == PF_Interrupt_CANCEL) {
    return PF_Err_NONE;
  }
  if (colorPickErr != PF_Err_NONE) {
    return colorPickErr;
  }

  const PF_Err persistErr = SetColorControllerParam(
    in_data,
    colorParam,
    nextColor
  );
  if (persistErr != PF_Err_NONE) {
    return persistErr;
  }
  MarkControllerParamHistoryDirty(
    in_data,
    ControllerColorValueParamIndex(slot),
    "color-ui-picked"
  );
  RequestCustomUIRefresh(in_data, out_data, extra);
  extra->evt_out_flags |= PF_EO_HANDLED_EVENT | PF_EO_UPDATE_NOW;
  return PF_Err_NONE;
}

PF_Err BeginAngleControllerDrag(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!in_data || !out_data || !extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if ((*extra->contextH)->w_type != PF_Window_EFFECT ||
      extra->effect_win.area != PF_EA_CONTROL) {
    return PF_Err_NONE;
  }

  const RuntimeSketchBundle bundle =
    ReadEffectRuntimeSketchBundle(in_data, params);
  int slot = -1;
  if (!TryResolveAngleUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }
  const PF_Point mousePoint =
    *reinterpret_cast<PF_Point*>(&extra->u.do_click.screen_point);
  const AngleUiLayout layout =
    ComputeAngleUiLayout(extra->effect_win.current_frame);
  const AngleUiDragTarget dragTarget =
    ResolveAngleHitTarget(layout, mousePoint);
  if (dragTarget == AngleUiDragTarget::kNone) {
    return PF_Err_NONE;
  }

  if (dragTarget == AngleUiDragTarget::kTurnsText ||
      dragTarget == AngleUiDragTarget::kDegreesText) {
    PF_ParamDef* angleParam = params
      ? params[ControllerAngleValueParamIndex(slot)]
      : NULL;
    const double angleDegrees =
      angleParam ? static_cast<double>(angleParam->u.fs_d.value) : 0.0;
    UpdateAngleDrag(
      extra,
      slot,
      dragTarget,
      static_cast<double>(mousePoint.h),
      true,
      angleDegrees,
      angleParam != NULL,
      false
    );
    RequestCustomUIRefresh(in_data, out_data, extra);
    extra->evt_out_flags |= PF_EO_HANDLED_EVENT | PF_EO_UPDATE_NOW;
    return PF_Err_NONE;
  }

  double trackedValue = 0.0;
  const bool hasTrackedValue =
    TryComputePointerDegrees(layout, mousePoint, &trackedValue);

  UpdateAngleDrag(
    extra,
    slot,
    dragTarget,
    trackedValue,
    hasTrackedValue,
    0.0,
    false,
    false
  );
  RequestCustomUIRefresh(in_data, out_data, extra);
  extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return PF_Err_NONE;
}

PF_Err UpdateAngleControllerDrag(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!in_data || !out_data || !params || !extra) {
    return PF_Err_NONE;
  }

  const int slot =
    static_cast<int>(extra->u.do_click.continue_refcon[0]) - 1;
  if (slot < 0 || slot >= kControllerSlotCount) {
    return PF_Err_NONE;
  }
  const RuntimeSketchBundle bundle =
    ReadEffectRuntimeSketchBundle(in_data, params);
  if (ResolveControllerSlotKind(bundle, slot) !=
      RuntimeControllerSlotKind::kAngle) {
    return PF_Err_NONE;
  }

  PF_ParamDef* angleParam =
    params[ControllerAngleValueParamIndex(slot)];
  if (!angleParam) {
    return PF_Err_NONE;
  }

  const AngleUiDragTarget dragTarget =
    DecodeAngleDragTarget(extra->u.do_click.continue_refcon[1]);
  if (dragTarget == AngleUiDragTarget::kNone) {
    return PF_Err_NONE;
  }

  const PF_Point mousePoint =
    *reinterpret_cast<PF_Point*>(&extra->u.do_click.screen_point);
  const double currentDegrees =
    static_cast<double>(angleParam->u.fs_d.value);
  double nextDegrees = currentDegrees;
  bool didChangeValue = false;

  if (dragTarget == AngleUiDragTarget::kTurnsText ||
      dragTarget == AngleUiDragTarget::kDegreesText) {
    double anchorMouseX = 0.0;
    double anchorDegrees = currentDegrees;
    const bool hasAnchorMouseX = DecodeAngleDragValue(
      extra->u.do_click.continue_refcon[2],
      &anchorMouseX
    );
    const bool hasAnchorDegrees = DecodeAngleDragValue(
      extra->u.do_click.continue_refcon[3],
      &anchorDegrees
    );
    if (!hasAnchorMouseX || !hasAnchorDegrees) {
      return PF_Err_NONE;
    }

    const double deltaPixels =
      static_cast<double>(mousePoint.h) - anchorMouseX;
    const bool isScrubbing =
      std::fabs(deltaPixels) >= kAngleControlScrubActivationDistance;
    if (isScrubbing) {
      int anchorTurns = 0;
      double anchorCycleDegrees = 0.0;
      SplitAngleDegrees(
        anchorDegrees,
        &anchorTurns,
        &anchorCycleDegrees
      );
      if (dragTarget == AngleUiDragTarget::kTurnsText) {
        const double turnDelta =
          deltaPixels / kAngleControlTurnsPixelsPerTurn;
        const int roundedTurns = static_cast<int>(std::round(
          static_cast<double>(anchorTurns) + turnDelta
        ));
        nextDegrees =
          ComposeAngleDegrees(roundedTurns, anchorCycleDegrees);
      } else {
        nextDegrees = ComposeAngleDegrees(
          anchorTurns,
          anchorCycleDegrees +
            (deltaPixels * kAngleControlDegreesPerPixel)
        );
      }
      didChangeValue =
        std::fabs(nextDegrees - currentDegrees) > 1e-6;
    }

    UpdateAngleDrag(
      extra,
      slot,
      dragTarget,
      anchorMouseX,
      true,
      anchorDegrees,
      true,
      true
    );

    if (didChangeValue) {
      const char* reason =
        dragTarget == AngleUiDragTarget::kTurnsText
          ? "angle-ui-turns-scrub"
          : "angle-ui-degrees-scrub";
      angleParam->u.fs_d.value = static_cast<PF_FpLong>(
        SanitizeAngleDegrees(nextDegrees)
      );
      angleParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
      MarkControllerParamHistoryDirty(
        in_data,
        ControllerAngleValueParamIndex(slot),
        reason
      );
    }

    RequestCustomUIRefresh(in_data, out_data, extra);
    extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
    return PF_Err_NONE;
  }

  if (dragTarget != AngleUiDragTarget::kKnob) {
    return PF_Err_NONE;
  }

  const AngleUiLayout layout =
    ComputeAngleUiLayout(extra->effect_win.current_frame);
  double pointerDegrees = 0.0;
  const bool hasPointerDegrees =
    TryComputePointerDegrees(layout, mousePoint, &pointerDegrees);
  double previousPointerDegrees = 0.0;
  const bool hasPreviousPointerDegrees = DecodeAngleDragValue(
    extra->u.do_click.continue_refcon[2],
    &previousPointerDegrees
  );
  if (hasPointerDegrees && hasPreviousPointerDegrees) {
    const double deltaDegrees =
      NormalizeAngleDelta(pointerDegrees - previousPointerDegrees);
    if (std::fabs(deltaDegrees) > 1e-6) {
      nextDegrees = currentDegrees + deltaDegrees;
      didChangeValue = true;
    }
  }
  UpdateAngleDrag(
    extra,
    slot,
    dragTarget,
    pointerDegrees,
    hasPointerDegrees,
    0.0,
    false,
    true
  );

  if (didChangeValue) {
    angleParam->u.fs_d.value = static_cast<PF_FpLong>(
      SanitizeAngleDegrees(nextDegrees)
    );
    angleParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
    MarkControllerParamHistoryDirty(
      in_data,
      ControllerAngleValueParamIndex(slot),
      "angle-ui-drag"
    );
  }

  RequestCustomUIRefresh(in_data, out_data, extra);
  return PF_Err_NONE;
}

PF_Err AdjustAngleControllerCursor(
  PF_InData* in_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if ((*extra->contextH)->w_type != PF_Window_EFFECT ||
      extra->effect_win.area != PF_EA_CONTROL) {
    return PF_Err_NONE;
  }

  const RuntimeSketchBundle bundle =
    ReadEffectRuntimeSketchBundle(in_data, params);
  int slot = -1;
  if (!TryResolveAngleUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }

  const PF_Point mousePoint =
    *reinterpret_cast<PF_Point*>(&extra->u.adjust_cursor.screen_point);
  const AngleUiLayout layout =
    ComputeAngleUiLayout(extra->effect_win.current_frame);
  switch (ResolveAngleHitTarget(layout, mousePoint)) {
    case AngleUiDragTarget::kKnob:
      extra->u.adjust_cursor.set_cursor = PF_Cursor_ROTATE_Z;
      extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
      break;
    case AngleUiDragTarget::kTurnsText:
    case AngleUiDragTarget::kDegreesText:
      extra->u.adjust_cursor.set_cursor =
        PF_Cursor_FINGER_POINTER_SCRUB;
      extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
      break;
    default:
      break;
  }
  return PF_Err_NONE;
}

}  // namespace

PF_Err HandleCustomEffectUIEvent(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  const PF_WindowType windowType = (*extra->contextH)->w_type;
  if (windowType == PF_Window_COMP) {
    if (extra->e_type == PF_Event_DRAW) {
      ObserveCodeEditorCompDraw();
    }
    // This probe never draws, changes output flags, or consumes Comp input.
    return PF_Err_NONE;
  }
  if (windowType != PF_Window_EFFECT) {
    return PF_Err_NONE;
  }

  switch (extra->e_type) {
    case PF_Event_DO_CLICK: {
      const PF_Err codeErr =
        ClickCodeControlUi(in_data, params, extra);
      if (codeErr != PF_Err_NONE) {
        return codeErr;
      }
      if (extra->evt_out_flags & PF_EO_HANDLED_EVENT) {
        return PF_Err_NONE;
      }
      const PF_Err colorErr =
        ClickColorControllerUi(in_data, out_data, params, extra);
      if (colorErr != PF_Err_NONE) {
        return colorErr;
      }
      if (extra->evt_out_flags & PF_EO_HANDLED_EVENT) {
        return PF_Err_NONE;
      }
      return BeginAngleControllerDrag(
        in_data,
        out_data,
        params,
        extra
      );
    }
    case PF_Event_DRAG:
      return UpdateAngleControllerDrag(
        in_data,
        out_data,
        params,
        extra
      );
    case PF_Event_DRAW: {
      const PF_Err codeErr =
        DrawCodeControlUi(in_data, extra);
      if (codeErr != PF_Err_NONE) {
        return codeErr;
      }
      if (extra->evt_out_flags & PF_EO_HANDLED_EVENT) {
        return PF_Err_NONE;
      }
      const PF_Err restartErr = DrawRestartControlUi(extra);
      if (restartErr != PF_Err_NONE) {
        return restartErr;
      }
      if (extra->evt_out_flags & PF_EO_HANDLED_EVENT) {
        return PF_Err_NONE;
      }
      const PF_Err colorErr =
        DrawColorControllerUi(in_data, params, extra);
      if (colorErr != PF_Err_NONE) {
        return colorErr;
      }
      if (extra->evt_out_flags & PF_EO_HANDLED_EVENT) {
        return PF_Err_NONE;
      }
      return DrawAngleControllerUi(
        in_data,
        params,
        extra
      );
    }
    case PF_Event_ADJUST_CURSOR: {
      const PF_Err codeErr = AdjustCodeControlCursor(extra);
      if (codeErr != PF_Err_NONE) {
        return codeErr;
      }
      if (extra->evt_out_flags & PF_EO_HANDLED_EVENT) {
        return PF_Err_NONE;
      }
      return AdjustAngleControllerCursor(
        in_data,
        params,
        extra
      );
    }
    default:
      return PF_Err_NONE;
  }
}

}  // namespace momentum
