#pragma once

#include "controllers/types.h"

namespace momentum {

enum ParamIndex {
  PARAM_INPUT = 0,
  PARAM_CREATION_TOKEN,
  PARAM_CODE_SNAPSHOT,
  PARAM_RESTART_CUE,
  PARAM_CONTROLLER_SLOT_BASE,
  PARAM_CONTROLLER_AFTER =
    PARAM_CONTROLLER_SLOT_BASE + (kControllerSlotCount * kControllerParamKindsPerSlot),
  PARAM_CODE_COMMIT = PARAM_CONTROLLER_AFTER,
  PARAM_DEFAULT_CODE,
  PARAM_COUNT,
};

// Keep the ids written into existing AE projects stable. Disk id 1 belonged to
// the retired Revision parameter and must never be reused. The creation token
// is one-shot transport metadata; rendered identity comes from Sequence Data.
constexpr int kCreationTokenParamDiskId = 2;
constexpr int kControllerSlotDiskIdBase = 3;
constexpr int kCodeSnapshotParamDiskId =
  kControllerSlotDiskIdBase +
  (kControllerSlotCount * kControllerParamKindsPerSlot) +
  1;
constexpr int kCodeCommitParamDiskId = kCodeSnapshotParamDiskId + 1;
constexpr int kDefaultCodeParamDiskId = kCodeCommitParamDiskId + 1;
// The first Restart prototype used an Arbitrary stream at this id. Never map
// that persisted type to the native popup stream used by current builds.
constexpr int kRetiredRestartArbitraryParamDiskId =
  kDefaultCodeParamDiskId + 1;
constexpr int kRestartCueParamDiskId =
  kRetiredRestartArbitraryParamDiskId + 1;

constexpr int ControllerSlotParamBaseIndex(int slot) {
  return PARAM_CONTROLLER_SLOT_BASE + (slot * kControllerParamKindsPerSlot);
}

constexpr int ControllerSlotParamBaseDiskId(int slot) {
  return kControllerSlotDiskIdBase + (slot * kControllerParamKindsPerSlot);
}

constexpr int ControllerPointParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot);
}

constexpr int ControllerPointParamDiskId(int slot) {
  return ControllerSlotParamBaseDiskId(slot);
}

constexpr int ControllerSliderParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 1;
}

constexpr int ControllerSliderParamDiskId(int slot) {
  return ControllerSlotParamBaseDiskId(slot) + 1;
}

constexpr int ControllerColorParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 2;
}

constexpr int ControllerColorParamDiskId(int slot) {
  return ControllerSlotParamBaseDiskId(slot) + 2;
}

constexpr int ControllerColorValueParamIndex(int slot) {
  return ControllerColorParamIndex(slot);
}

constexpr int ControllerCheckboxParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 3;
}

constexpr int ControllerCheckboxParamDiskId(int slot) {
  return ControllerSlotParamBaseDiskId(slot) + 3;
}

constexpr int ControllerSelectParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 4;
}

constexpr int ControllerSelectParamDiskId(int slot) {
  return ControllerSlotParamBaseDiskId(slot) + 4;
}

constexpr int ControllerAngleValueParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 5;
}

constexpr int ControllerAngleValueParamDiskId(int slot) {
  return ControllerSlotParamBaseDiskId(slot) + 5;
}

constexpr int ControllerAngleUiParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 6;
}

constexpr int ControllerAngleUiParamDiskId(int slot) {
  return ControllerSlotParamBaseDiskId(slot) + 6;
}

}  // namespace momentum
