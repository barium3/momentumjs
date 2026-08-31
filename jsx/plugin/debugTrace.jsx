function getActiveCompTimeInfo() {
  try {
    if (
      !app.project ||
      !app.project.activeItem ||
      !(app.project.activeItem instanceof CompItem)
    ) {
      return JSON.stringify({ ok: true, active: false });
    }

    var comp = app.project.activeItem;
    var timeSeconds = Number(comp.time || 0);
    var frameDuration = Number(comp.frameDuration || 0);
    return JSON.stringify({
      ok: true,
      active: true,
      compId: Number(comp.id),
      timeSeconds: timeSeconds,
      duration: Number(comp.duration || 0),
      frameDuration: frameDuration,
      workAreaDuration: Number(comp.workAreaDuration || 0),
      workAreaStart: Number(comp.workAreaStart || 0),
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: "Cannot read active comp time: " + error.toString(),
    });
  }
}
