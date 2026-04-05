#pragma once

#include "../model/momentum_types.h"

namespace momentum {

void SetJsNumber(JSContextRef ctx, JSObjectRef object, const char* name, double value);
void InstallRuntimeBootstrap(JSContextRef ctx, JSObjectRef globalObject);

}
