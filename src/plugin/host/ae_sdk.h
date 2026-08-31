#pragma once

// One canonical boundary for the Adobe After Effects SDK. Domain headers use
// this instead of repeating an implicit, order-sensitive list of AE headers.
#include "AEConfig.h"
#include "entry.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_EffectCBSuites.h"
#include "AE_EffectPixelFormat.h"
#include "AE_EffectGPUSuites.h"
#include "AE_GeneralPlug.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "String_Utils.h"
#include "AEFX_SuiteHelper.h"

// Keep the host-facing code source-compatible with both the AE 2022 SDK and
// newer SDKs. Momentum only uses calls already present in these older suites.
#ifndef kAEGPEffectSuiteVersion5
typedef AEGP_EffectSuite4 AEGP_EffectSuite5;
#define kAEGPEffectSuiteVersion5 kAEGPEffectSuiteVersion4
#endif

#ifdef kAEGPStreamSuiteVersion6
#define MOMENTUM_AE_HAS_UNIQUE_STREAM_ID 1
#else
#define MOMENTUM_AE_HAS_UNIQUE_STREAM_ID 0
typedef AEGP_StreamSuite5 AEGP_StreamSuite6;
#define kAEGPStreamSuiteVersion6 kAEGPStreamSuiteVersion5
#endif

#ifndef kAEGPKeyframeSuiteVersion5
typedef AEGP_KeyframeSuite4 AEGP_KeyframeSuite5;
#define kAEGPKeyframeSuiteVersion5 kAEGPKeyframeSuiteVersion4
#endif

// AE 2023+ renamed this field at preprocessing time. AE 2022 exposes the same
// fixed-size field as `name`.
#ifndef PF_DEF_NAME
#define PF_DEF_NAME name
#endif
