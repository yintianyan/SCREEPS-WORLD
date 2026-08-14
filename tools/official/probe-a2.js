// 探针 A2：议程 + 侦察任务（R6a/R6b 观测，精简版）
(function () {
  Memory.__diag = JSON.stringify({
    v: Memory.schemaVersion != null ? Memory.schemaVersion : null,
    t: Game.time,
    posture: Memory.kernel && Memory.kernel.strategy ? Memory.kernel.strategy.posture : null,
    agenda: Memory.kernel && Memory.kernel.agenda ? Memory.kernel.agenda.initiative : null,
    agendaAge: Memory.kernel && Memory.kernel.agenda ? Game.time - Memory.kernel.agenda.since : null,
    prospect: Memory.kernel && Memory.kernel.prospect
      ? { target: Memory.kernel.prospect.target, spawned: Memory.kernel.prospect.spawned }
      : null,
    prospectCd: Memory.kernel && Memory.kernel.prospectCooldown ? Object.keys(Memory.kernel.prospectCooldown) : [],
  });
})();
