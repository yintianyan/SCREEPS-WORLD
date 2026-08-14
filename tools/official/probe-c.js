// 探针 C：事件环（segment 2）— EnergyTransfer(k=24) 与 WarOutcome(k=23) 计数与最近样本
(function () {
  var events = [];
  try {
    var seg = JSON.parse(RawMemory.segments[2] || "null");
    if (seg && seg.events) events = seg.events;
  } catch (e) {}
  var aids = 0, wars = 0, lastAid = null, lastWar = null;
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.k === 24) { aids++; lastAid = { t: ev.t, r: ev.r, d: ev.d }; }
    if (ev.k === 23) { wars++; lastWar = { t: ev.t, r: ev.r, d: ev.d }; }
  }
  Memory.__diag = JSON.stringify({ eventCount: events.length, aids: aids, wars: wars, lastAid: lastAid, lastWar: lastWar });
})();
