#pragma once

// Single source of truth for the AE/PiPL capability contract.
// Keep these as numeric macros because both Rez and C++ include this file.
#define MOMENTUM_EFFECT_OUT_FLAGS 0x06008416
#define MOMENTUM_EFFECT_OUT_FLAGS2_CPU 0x08A21401
#define MOMENTUM_EFFECT_OUT_FLAGS2_GPU 0x0AA21401

#define MOMENTUM_EFFECT_OUT_FLAGS2 MOMENTUM_EFFECT_OUT_FLAGS2_GPU
