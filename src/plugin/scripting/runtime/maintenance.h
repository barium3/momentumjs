#pragma once

#include <cstdint>
#include <string>

namespace momentum::runtime_internal {

void RotateLogFileIfNeeded(
  const std::string& logPath,
  std::uintmax_t maximumBytes
);

void RunRuntimeMaintenance(const std::string& runtimeDirectory);

}  // namespace momentum::runtime_internal
