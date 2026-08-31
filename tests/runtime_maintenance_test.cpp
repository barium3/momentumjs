#include "scripting/runtime/maintenance.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace {

namespace fs = std::filesystem;

bool Require(bool condition, const char* message) {
  if (!condition) {
    std::cerr << message << '\n';
  }
  return condition;
}

void WriteBytes(const fs::path& path, std::size_t byteCount) {
  fs::create_directories(path.parent_path());
  std::ofstream stream(path, std::ios::binary | std::ios::trunc);
  const std::string block(4096, 'x');
  while (byteCount > 0) {
    const std::size_t count = std::min(byteCount, block.size());
    stream.write(block.data(), static_cast<std::streamsize>(count));
    byteCount -= count;
  }
}

std::size_t CountEntries(const fs::path& directory) {
  std::size_t count = 0;
  for (const auto& entry : fs::directory_iterator(directory)) {
    (void)entry;
    ++count;
  }
  return count;
}

}  // namespace

int main() {
  const fs::path root = fs::temp_directory_path() /
    ("momentum-runtime-maintenance-" + std::to_string(
      std::chrono::steady_clock::now().time_since_epoch().count()
    ));
  fs::create_directories(root);

  WriteBytes(root / "instances" / "legacy" / "state.txt", 1);
  WriteBytes(root / "edit-transactions" / "legacy.txt", 1);
  WriteBytes(root / "instance_trace.log", 1);
  WriteBytes(root / "code_editor_request.txt", 1);
  for (int index = 0; index < 35; ++index) {
    WriteBytes(
      root / "code-edit-sessions" / ("session-" + std::to_string(index)) /
        "session.txt",
      1
    );
  }
  WriteBytes(root / "creation-transports" / "active" / "sketch.js", 1);
  for (int index = 0; index < 6; ++index) {
    WriteBytes(
      root / ("effect_runtime.archive-" + std::to_string(index) + ".log"),
      1
    );
  }
  WriteBytes(root / "effect_runtime.log", 1024U * 1024U + 1U);
  WriteBytes(root / "code_editor.log", 512U * 1024U + 1U);

  momentum::runtime_internal::RunRuntimeMaintenance(root.string());

  bool passed = true;
  passed &= Require(!fs::exists(root / "instances"), "legacy instances survived");
  passed &= Require(
    !fs::exists(root / "edit-transactions"),
    "legacy edit transactions survived"
  );
  passed &= Require(
    !fs::exists(root / "instance_trace.log"),
    "legacy instance trace survived"
  );
  passed &= Require(
    !fs::exists(root / "code_editor_request.txt"),
    "legacy editor request survived"
  );
  passed &= Require(
    CountEntries(root / "code-edit-sessions") == 32,
    "session retention limit was not enforced"
  );
  passed &= Require(
    fs::exists(root / "creation-transports" / "active" / "sketch.js"),
    "an active creation transport was removed"
  );
  passed &= Require(
    fs::exists(root / "effect_runtime.log.1"),
    "effect runtime log was not rotated"
  );
  passed &= Require(
    fs::exists(root / "code_editor.log.1"),
    "Code editor log was not rotated"
  );
  std::size_t archivedDiagnosticCount = 0;
  for (const auto& entry : fs::directory_iterator(root)) {
    const std::string filename = entry.path().filename().string();
    if (filename.rfind("effect_runtime.archive-", 0) == 0) {
      ++archivedDiagnosticCount;
    }
  }
  passed &= Require(
    archivedDiagnosticCount == 4,
    "archived runtime diagnostic retention limit was not enforced"
  );

  std::error_code cleanupError;
  fs::remove_all(root, cleanupError);
  return passed ? 0 : 1;
}
