// 探针 D：内核运行统计（CPU/bucket 采样 + 错误热点 + 跳过原因）
(function () {
  Memory.__diag = JSON.stringify({
    t: Game.time,
    bucket: Game.cpu.bucket,
    cpuLimit: Game.cpu.limit,
    stats: Memory.kernel ? Memory.kernel.stats : null,
    skips: Memory.kernel ? Memory.kernel.skipReasons : null,
    tier: Memory.kernel ? Memory.kernel.tier : null,
  });
})();
