/**
 * 临时探测：读私服 tuning 完整状态（含 P1/P3/P4 新字段）。
 * 用完即删。
 */
storage.db.users.find({ steam: { $exists: true } }).then(function (us) {
  var u = us[0];
  if (!u) return "no-user";
  var uid = "" + u._id;
  return storage.env.get(storage.env.keys.MEMORY + uid).then(function (raw) {
    var m = {};
    try { m = JSON.parse(raw) || {}; } catch (e) {}
    var t = m.kernel && m.kernel.tuning;
    if (!t) return "no tuning (schemaVersion=" + m.schemaVersion + ")";
    var rooms = {};
    Object.keys(t.rooms || {}).forEach(function (rm) {
      var rt = t.rooms[rm];
      var le = (t.lastEval && t.lastEval[rm]) || {};
      rooms[rm] = {
        lastAdjusted: rt.lastAdjusted || {},
        lastTrend: rt.lastTrend || {},
        pendingValidation: rt.pendingValidation || null,
        frozenParams: rt.frozenParams || null,
        lastEval: {
          tick: le.tick,
          adjustments: le.adjustments || [],
          skipped: le.skipped || null,
          verifySkipped: le.verifySkipped || null,
          pendingValidations: le.pendingValidations || null,
          frozenParams: le.frozenParams || null,
          blockedParams: le.blockedParams || null
        }
      };
    });
    return JSON.stringify({
      tick: (storage.db.rooms.findOne() || {}).time,
      schemaVersion: m.schemaVersion,
      baselineVersion: t.baselineVersion,
      lastTuned: t.lastTuned,
      rooms: rooms
    }, null, 2);
  });
});
