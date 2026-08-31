#include "scripting/runtime/maintenance.h"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <mutex>
#include <vector>

namespace momentum::runtime_internal {

namespace {

namespace fs = std::filesystem;

struct RuntimeEntry {
  fs::path path;
  fs::file_time_type modifiedAt;
};

void RemovePath(const fs::path& path) {
  std::error_code error;
  fs::remove_all(path, error);
}

void RemoveFileOlderThan(
  const fs::path& path,
  const std::chrono::hours& maximumAge
) {
  std::error_code existsError;
  if (!fs::exists(path, existsError) || existsError) {
    return;
  }
  std::error_code timeError;
  const fs::file_time_type modifiedAt = fs::last_write_time(path, timeError);
  if (!timeError &&
      modifiedAt < fs::file_time_type::clock::now() - maximumAge) {
    RemovePath(path);
  }
}

void PruneDirectory(
  const fs::path& directory,
  const std::chrono::hours& maximumAge,
  std::size_t maximumEntries
) {
  std::error_code existsError;
  if (!fs::is_directory(directory, existsError) || existsError) {
    return;
  }

  const fs::file_time_type cutoff =
    fs::file_time_type::clock::now() - maximumAge;
  std::vector<RuntimeEntry> retained;
  std::error_code iteratorError;
  for (fs::directory_iterator iterator(directory, iteratorError), end;
       !iteratorError && iterator != end;
       iterator.increment(iteratorError)) {
    std::error_code timeError;
    const fs::file_time_type modifiedAt =
      fs::last_write_time(iterator->path(), timeError);
    if (timeError || modifiedAt < cutoff) {
      RemovePath(iterator->path());
      continue;
    }
    retained.push_back(RuntimeEntry{iterator->path(), modifiedAt});
  }

  if (retained.size() <= maximumEntries) {
    return;
  }
  std::sort(
    retained.begin(),
    retained.end(),
    [](const RuntimeEntry& left, const RuntimeEntry& right) {
      return left.modifiedAt > right.modifiedAt;
    }
  );
  for (std::size_t index = maximumEntries; index < retained.size(); ++index) {
    RemovePath(retained[index].path);
  }
}

void PruneArchivedRuntimeLogs(
  const fs::path& runtimeDirectory,
  const std::chrono::hours& maximumAge,
  std::size_t maximumEntries
) {
  const fs::file_time_type cutoff =
    fs::file_time_type::clock::now() - maximumAge;
  std::vector<RuntimeEntry> retained;
  std::error_code iteratorError;
  for (fs::directory_iterator iterator(runtimeDirectory, iteratorError), end;
       !iteratorError && iterator != end;
       iterator.increment(iteratorError)) {
    std::error_code typeError;
    if (!iterator->is_regular_file(typeError) || typeError) {
      continue;
    }
    const std::string filename = iterator->path().filename().string();
    if (filename == "effect_runtime.log" ||
        filename.rfind("effect_runtime.", 0) != 0 ||
        filename.size() < 4 ||
        filename.substr(filename.size() - 4) != ".log") {
      continue;
    }
    std::error_code timeError;
    const fs::file_time_type modifiedAt =
      fs::last_write_time(iterator->path(), timeError);
    if (timeError || modifiedAt < cutoff) {
      RemovePath(iterator->path());
      continue;
    }
    retained.push_back(RuntimeEntry{iterator->path(), modifiedAt});
  }

  std::sort(
    retained.begin(),
    retained.end(),
    [](const RuntimeEntry& left, const RuntimeEntry& right) {
      return left.modifiedAt > right.modifiedAt;
    }
  );
  for (std::size_t index = maximumEntries; index < retained.size(); ++index) {
    RemovePath(retained[index].path);
  }
}

void PerformRuntimeMaintenance(const fs::path& runtimeDirectory) {
  std::error_code directoryError;
  fs::create_directories(runtimeDirectory, directoryError);
  if (directoryError) {
    return;
  }

  // These belonged to retired ref/id-based editor transports and are no
  // longer read by either the native plugin or CEP.
  RemovePath(runtimeDirectory / "instances");
  RemovePath(runtimeDirectory / "edit-transactions");
  RemovePath(runtimeDirectory / "instance_trace.log");
  RemovePath(runtimeDirectory / "code_editor_request.txt");

  PruneDirectory(
    runtimeDirectory / "code-edit-sessions",
    std::chrono::hours(24),
    32
  );
  PruneDirectory(
    runtimeDirectory / "code-edit-results",
    std::chrono::hours(24),
    64
  );
  PruneDirectory(
    runtimeDirectory / "creation-transports",
    std::chrono::hours(24 * 14),
    64
  );
  RemoveFileOlderThan(
    runtimeDirectory / "code-edit-commit.pending",
    std::chrono::hours(1)
  );
  PruneArchivedRuntimeLogs(
    runtimeDirectory,
    std::chrono::hours(24 * 14),
    4
  );

  RotateLogFileIfNeeded(
    (runtimeDirectory / "effect_runtime.log").string(),
    1024U * 1024U
  );
  RotateLogFileIfNeeded(
    (runtimeDirectory / "code_editor.log").string(),
    512U * 1024U
  );
}

}  // namespace

void RotateLogFileIfNeeded(
  const std::string& logPath,
  std::uintmax_t maximumBytes
) {
  if (logPath.empty() || maximumBytes == 0) {
    return;
  }
  std::error_code sizeError;
  const std::uintmax_t currentSize = fs::file_size(logPath, sizeError);
  if (sizeError || currentSize <= maximumBytes) {
    return;
  }

  const fs::path archivePath = fs::path(logPath + ".1");
  std::error_code removeError;
  fs::remove(archivePath, removeError);
  std::error_code renameError;
  fs::rename(fs::path(logPath), archivePath, renameError);
  if (renameError) {
    std::error_code truncateError;
    fs::resize_file(fs::path(logPath), 0, truncateError);
  }
}

void RunRuntimeMaintenance(const std::string& runtimeDirectory) {
  if (runtimeDirectory.empty()) {
    return;
  }
  static std::once_flag maintenanceOnce;
  std::call_once(maintenanceOnce, [&]() {
    PerformRuntimeMaintenance(fs::path(runtimeDirectory));
  });
}

}  // namespace momentum::runtime_internal
