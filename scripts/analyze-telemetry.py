#!/usr/bin/env python3
"""
Screeps E1S9 Telemetry Analyzer
读取 collect-telemetry.sh 产出的 JSONL 数据，输出经济趋势、角色效率、瓶颈分析。

用法: python3 scripts/analyze-telemetry.py [数据文件路径]
默认: telemetry/E1S9-telemetry.jsonl
"""

import json
import sys
from pathlib import Path
from collections import defaultdict

def load_snapshots(path: str) -> list[dict]:
    snapshots = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                snapshots.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return snapshots

def analyze(snapshots: list[dict]):
    if not snapshots:
        print("无数据")
        return

    print(f"{'='*70}")
    print(f"  E1S9 Telemetry Analysis — {len(snapshots)} snapshots")
    print(f"  tick range: {snapshots[0]['meta']['gameTime']} → {snapshots[-1]['meta']['gameTime']}")
    print(f"  时间跨度: {snapshots[-1]['meta']['gameTime'] - snapshots[0]['meta']['gameTime']} ticks")
    print(f"{'='*70}")

    # === 1. 经济趋势 ===
    print(f"\n{'─'*70}")
    print("  [1] 经济趋势")
    print(f"{'─'*70}")
    print(f"  {'tick':>8} {'reserve':>8} {'spawn':>6} {'ext':>6} {'cont':>6} {'creep':>6} {'capUtil':>7}")
    for s in snapshots:
        eco = s.get("economy", {})
        bd = eco.get("breakdown", {})
        print(f"  {s['meta']['gameTime']:>8} {eco.get('totalReserve',0):>8} "
              f"{bd.get('spawn',0):>6} {bd.get('extensions',0):>6} "
              f"{bd.get('containers',0):>6} {bd.get('creeps',0):>6} "
              f"{eco.get('capacityUtilization',0):>6}%")

    # 计算储备变化速率
    if len(snapshots) >= 2:
        first, last = snapshots[0], snapshots[-1]
        dt = last["meta"]["gameTime"] - first["meta"]["gameTime"]
        if dt > 0:
            d_reserve = last["economy"]["totalReserve"] - first["economy"]["totalReserve"]
            print(f"\n  储备变化速率: {d_reserve/dt:+.2f} energy/tick (净收入−支出)")

    # === 2. Controller 升级进度 ===
    print(f"\n{'─'*70}")
    print("  [2] Controller 升级")
    print(f"{'─'*70}")
    ctrl_first = snapshots[0].get("controller", {})
    ctrl_last = snapshots[-1].get("controller", {})
    if ctrl_first and ctrl_last:
        dt = snapshots[-1]["meta"]["gameTime"] - snapshots[0]["meta"]["gameTime"]
        dp = ctrl_last.get("progress", 0) - ctrl_first.get("progress", 0)
        rate = dp / dt if dt > 0 else 0
        print(f"  Level: {ctrl_last.get('level')} | Progress: {ctrl_last.get('progress')}")
        print(f"  升级速率: {rate:.3f}/tick ({dp} in {dt} ticks)")
        # RCL 进度表
        rcl_targets = {1: 200, 2: 45000, 3: 135000, 4: 405000, 5: 1215000, 6: 3645000, 7: 10935000}
        level = ctrl_last.get("level", 1)
        target = rcl_targets.get(level, 0)
        if target > 0 and rate > 0:
            remaining = target - ctrl_last.get("progress", 0)
            eta_ticks = remaining / rate
            print(f"  RCL{level}→RCL{level+1}: 还需 {remaining} progress, ETA ~{eta_ticks:.0f} ticks")

    # === 3. 人口统计 ===
    print(f"\n{'─'*70}")
    print("  [3] 人口统计 (最新快照)")
    print(f"{'─'*70}")
    pop = snapshots[-1].get("population", {})
    print(f"  总人口: {pop.get('total', 0)}")
    for role, info in pop.get("byRole", {}).items():
        print(f"    {role:>10}: count={info['count']} bodyParts={info['totalBodyParts']} "
              f"energy={info['totalEnergy']} avgTTL={info.get('avgTtl',0)} minTTL={info.get('minTtl',0)}")

    # === 4. 角色效率分析 ===
    print(f"\n{'─'*70}")
    print("  [4] 角色效率分析")
    print(f"{'─'*70}")

    # Harvester 效率：container 累积速率
    containers_history = []
    for s in snapshots:
        cont_e = sum(c.get("energy", 0) for c in s.get("containers", []))
        containers_history.append((s["meta"]["gameTime"], cont_e))

    if len(containers_history) >= 2:
        dt = containers_history[-1][0] - containers_history[0][0]
        de = containers_history[-1][1] - containers_history[0][1]
        if dt > 0:
            print(f"  Container 净累积: {de/dt:+.2f} energy/tick (harvester 产出 − 消费者取用)")

    # 各 container 状态
    print(f"\n  Container 详情 (最新):")
    for c in snapshots[-1].get("containers", []):
        label = "source" if c.get("isSourceContainer") else "controller" if c.get("isControllerContainer") else "other"
        decay_rate = ""
        # 计算 container 衰减
        hits_history = [(s["meta"]["gameTime"], next((cc["hits"] for cc in s.get("containers", []) if cc["x"]==c["x"] and cc["y"]==c["y"]), None)) for s in snapshots]
        hits_history = [(t, h) for t, h in hits_history if h is not None]
        if len(hits_history) >= 2:
            dt_h = hits_history[-1][0] - hits_history[0][0]
            dh = hits_history[-1][1] - hits_history[0][1]
            if dt_h > 0 and dh < 0:
                ticks_left = hits_history[-1][1] / abs(dh/dt_h)
                decay_rate = f" | 衰减 {dh/dt_h:.1f}/tick, 剩余 ~{ticks_left:.0f} ticks"
        print(f"    ({c['x']},{c['y']}) [{label}] e={c['energy']}/{c['energyCapacity']} "
              f"hits={c['hits']}/{c['hitsMax']}{decay_rate}")

    # === 5. 建造进度 ===
    print(f"\n{'─'*70}")
    print("  [5] 建造进度")
    print(f"{'─'*70}")
    sites_first = {f"{s['structureType']}@({s['x']},{s['y']})": s for s in snapshots[0].get("constructionSites", [])}
    sites_last = {f"{s['structureType']}@({s['x']},{s['y']})": s for s in snapshots[-1].get("constructionSites", [])}

    for key, site in sites_last.items():
        first_progress = sites_first.get(key, {}).get("progress", 0)
        dp = site["progress"] - first_progress
        dt = snapshots[-1]["meta"]["gameTime"] - snapshots[0]["meta"]["gameTime"]
        rate = dp / dt if dt > 0 else 0
        eta = (site["progressTotal"] - site["progress"]) / rate if rate > 0 else float('inf')
        eta_str = f"~{eta:.0f} ticks" if eta < 100000 else "停滞"
        print(f"  {site['structureType']:>10} ({site['x']},{site['y']}): "
              f"{site['progress']}/{site['progressTotal']} ({site['progressPct']}%) "
              f"rate={rate:.2f}/tick ETA={eta_str}")

    # 检查停滞的 site
    stalled = [k for k, s in sites_last.items() if k in sites_first and s["progress"] == sites_first[k]["progress"]]
    if stalled:
        print(f"\n  ⚠️  停滞工地: {stalled}")

    # === 6. Creep 移动追踪 ===
    print(f"\n{'─'*70}")
    print("  [6] Creep 移动追踪")
    print(f"{'─'*70}")
    # 追踪每个 creep 的位置变化
    creep_positions = defaultdict(list)
    for s in snapshots:
        for c in s.get("creeps", []):
            creep_positions[c["name"]].append((s["meta"]["gameTime"], c["x"], c["y"], c["energy"]))

    for name, history in sorted(creep_positions.items()):
        if len(history) < 2:
            continue
        role = name.split("-")[0]
        first_pos = (history[0][1], history[0][2])
        last_pos = (history[-1][1], history[-1][2])
        moved = first_pos != last_pos
        energy_change = history[-1][3] - history[0][3]

        # 计算是否卡住（位置不变）
        unique_positions = len(set((h[1], h[2]) for h in history))
        stuck_ratio = 1 - (unique_positions / len(history)) if len(history) > 1 else 0

        status = "🔴 STUCK" if stuck_ratio > 0.7 else "🟡 slow" if stuck_ratio > 0.3 else "🟢 active"
        print(f"  {role:>10} {name[-8:]}: ({first_pos[0]},{first_pos[1]})→({last_pos[0]},{last_pos[1]}) "
              f"Δe={energy_change:+d} {status} (unique_pos={unique_positions}/{len(history)})")

    # === 7. Creep Memory 状态 ===
    print(f"\n{'─'*70}")
    print("  [7] Creep Memory 状态 (最新)")
    print(f"{'─'*70}")
    creep_mems = snapshots[-1].get("creepMemory", {})
    mode_counts = defaultdict(int)
    stuck_creeps = []
    for name, mem in sorted(creep_mems.items()):
        role = mem.get("role", "?")
        mode = mem.get("mode", "?")
        stuck = mem.get("stuckTicks", 0)
        mode_counts[f"{role}/{mode}"] += 1
        if stuck > 0:
            stuck_creeps.append((name, role, stuck))
        assign = mem.get("assignment")
        assign_str = f"assign={assign['kind']}" if assign else "no-assign"
        print(f"  {role:>10} {name[-8:]}: mode={mode:<8} stuck={stuck} {assign_str}")

    print(f"\n  模式分布: {dict(mode_counts)}")
    if stuck_creeps:
        print(f"  ⚠️  卡位 creep: {[(n[-8:], r, s) for n, r, s in stuck_creeps]}")

    # === 8. Spawn Queue & Build Queue ===
    print(f"\n{'─'*70}")
    print("  [8] 队列状态 (最新)")
    print(f"{'─'*70}")
    mem = snapshots[-1].get("memory", {})
    sq = mem.get("spawnQueue", [])
    bq = mem.get("buildQueue", [])
    print(f"  SpawnQueue: {len(sq)} requests")
    for r in sq:
        print(f"    {r.get('key','?')}: role={r.get('role')} prio={r.get('priority')} body={r.get('body')}")
    print(f"  BuildQueue: {len(bq)} tasks")
    for t in bq[:10]:
        print(f"    {t.get('key','?')}: {t.get('structureType')} state={t.get('state')} prio={t.get('priority')}")

    # === 9. 瓶颈诊断 ===
    print(f"\n{'─'*70}")
    print("  [9] 瓶颈诊断")
    print(f"{'─'*70}")
    issues = []

    # 检查 source 利用率
    for src in snapshots[-1].get("sources", []):
        # 不能看瞬时值，但可以看是否有 harvester 在附近
        nearby_harvesters = [c for c in snapshots[-1].get("creeps", [])
                           if c["role"] == "harvester" and abs(c["x"]-src["x"]) <= 2 and abs(c["y"]-src["y"]) <= 2]
        if not nearby_harvesters:
            issues.append(f"Source ({src['x']},{src['y']}) 无 harvester 在附近")

    # 检查 hauler 是否空闲
    for name, mem in creep_mems.items():
        if mem.get("role") == "hauler" and mem.get("mode") == "idle":
            issues.append(f"Hauler {name[-8:]} 空闲 (mode=idle)")

    # 检查 container 是否满溢
    for c in snapshots[-1].get("containers", []):
        if c["energy"] >= c["energyCapacity"] * 0.95:
            issues.append(f"Container ({c['x']},{c['y']}) 接近满载 ({c['energy']}/{c['energyCapacity']})")

    # 检查 spawn 是否空闲
    for sp in snapshots[-1].get("spawns", []):
        cap = sp.get("energyCapacity", 300)
        if isinstance(cap, dict):
            cap = 300
        if sp["spawning"] is None and sp["energy"] >= cap * 0.8:
            if not sq:
                issues.append(f"Spawn 满能量但无孵化请求 (e={sp['energy']})")

    # 检查 builder 过多
    pop = snapshots[-1].get("population", {})
    builder_count = pop.get("byRole", {}).get("builder", {}).get("count", 0)
    harvester_count = pop.get("byRole", {}).get("harvester", {}).get("count", 0)
    if builder_count > harvester_count + 1:
        issues.append(f"Builder ({builder_count}) > Harvester+1 ({harvester_count+1})，可能过度孵化")

    # 检查 container 衰减
    for c in snapshots[-1].get("containers", []):
        if c["hits"] < c["hitsMax"] * 0.5:
            issues.append(f"Container ({c['x']},{c['y']}) 血量过低 ({c['hits']}/{c['hitsMax']})")

    if issues:
        for i, issue in enumerate(issues, 1):
            print(f"  {i}. {issue}")
    else:
        print("  ✅ 未发现明显瓶颈")

    print(f"\n{'='*70}")


if __name__ == "__main__":
    data_file = sys.argv[1] if len(sys.argv) > 1 else "telemetry/E1S9-telemetry.jsonl"
    if not Path(data_file).exists():
        print(f"数据文件不存在: {data_file}")
        print("请先运行: bash scripts/collect-telemetry.sh")
        sys.exit(1)

    snapshots = load_snapshots(data_file)
    analyze(snapshots)
