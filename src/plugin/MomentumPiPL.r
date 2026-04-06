#include "AEConfig.h"
#include "AE_EffectVers.h"
#include "momentum_version.h"

#ifndef AE_OS_WIN
  #include <AE_General.r>
#endif

resource 'PiPL' (16000) {
  {
    Kind {
      AEEffect
    },
    Name {
      "Momentum"
    },
    Category {
      "Momentum"
    },
#if defined(AE_OS_MAC)
    CodeMacIntel64 {"EffectMain"},
    CodeMacARM64 {"EffectMain"},
#endif
    AE_PiPL_Version {
      2,
      0
    },
    AE_Effect_Spec_Version {
      PF_PLUG_IN_VERSION,
      PF_PLUG_IN_SUBVERS
    },
    AE_Effect_Version {
      MOMENTUM_VERSION_PIPL
    },
    AE_Effect_Info_Flags {
      0
    },
    AE_Effect_Global_OutFlags {
      0x06008404
    },
    AE_Effect_Global_OutFlags_2 {
      0x02001401
    },
    AE_Effect_Match_Name {
      "Momentum"
    },
    AE_Reserved_Info {
      0
    },
    AE_Effect_Support_URL {
      "https://github.com/barium3/momentum"
    }
  }
};
