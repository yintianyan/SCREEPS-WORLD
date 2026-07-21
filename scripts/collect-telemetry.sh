#!/bin/bash
# Screeps E1S9 运行时数据采集脚本
# 用法: ./scripts/collect-telemetry.sh [采集次数] [间隔秒数]
# 默认: 采集 10 次，每次间隔 10 秒
# 输出: telemetry/E1S9-telemetry.jsonl (每行一个完整快照)

set -euo pipefail

SERVER_DIR="/Users/songhao/Desktop/screeps-server"
PROJECT_DIR="/Users/songhao/Desktop/SCREEPS WORLD"
OUTPUT_DIR="$PROJECT_DIR/telemetry"
OUTPUT_FILE="$OUTPUT_DIR/E1S9-telemetry.jsonl"
UID_VAL="6a5f57e96a9d35012c0aedbf"
ROOM="E1S9"

COLLECT_COUNT="${1:-10}"
INTERVAL="${2:-10}"

mkdir -p "$OUTPUT_DIR"

echo "=== Screeps Telemetry Collector ==="
echo "Room: $ROOM | 采集 $COLLECT_COUNT 次 | 间隔 ${INTERVAL}s"
echo "输出: $OUTPUT_FILE"
echo ""

collect_snapshot() {
  local game_time
  game_time=$(cd "$SERVER_DIR" && docker compose exec -T redis redis-cli get gameTime 2>/dev/null | tr -d '\r')

  # MongoDB 采集所有对象数据
  local mongo_data
  mongo_data=$(cd "$SERVER_DIR" && docker compose exec -T mongo mongosh --quiet --eval "
const db2 = db.getSiblingDB('screeps');
const uid = '$UID_VAL';
const room = '$ROOM';

const result = {
  meta: {
    gameTime: $game_time,
    collectedAt: new Date().toISOString(),
    room: room
  },

  // === 地形（仅首次采集有意义，后续不变）===
  terrain: (() => {
    const t = db2.getCollection('rooms.terrain').findOne({room: room});
    if (!t || !t.terrain) return null;
    // 压缩为 50x50 数组: 0=plain, 1=wall, 2=swamp
    const grid = [];
    for (let y = 0; y < 50; y++) {
      const row = [];
      for (let x = 0; x < 50; x++) {
        const c = t.terrain[y * 50 + x];
        row.push(c === '1' ? 1 : c === '2' ? 2 : 0);
      }
      grid.push(row);
    }
    return grid;
  })(),

  // === Controller ===
  controller: (() => {
    const c = db2.getCollection('rooms.objects').findOne({type: 'controller', room: room, user: uid});
    if (!c) return null;
    return {
      x: c.x, y: c.y,
      level: c.level,
      progress: c.progress || 0,
      progressTotal: c.progressTotal || 0,
      ticksToDowngrade: c.ticksToDowngrade || 0,
      safeMode: c.safeMode || 0,
      safeModeAvailable: c.safeModeAvailable || 0
    };
  })(),

  // === Sources ===
  sources: db2.getCollection('rooms.objects').find({type: 'source', room: room}).toArray().map(s => ({
    id: String(s._id),
    x: s.x, y: s.y,
    energy: s.energy,
    energyCapacity: s.energyCapacity,
    ticksToRegeneration: s.ticksToRegeneration || null
  })),

  // === Mineral ===
  mineral: (() => {
    const m = db2.getCollection('rooms.objects').findOne({type: 'mineral', room: room});
    if (!m) return null;
    return { x: m.x, y: m.y, type: m.mineralType, amount: m.mineralAmount };
  })(),

  // === Spawn ===
  spawns: db2.getCollection('rooms.objects').find({type: 'spawn', room: room, user: uid}).toArray().map(s => ({
    name: s.name,
    x: s.x, y: s.y,
    energy: (s.store && s.store.energy) || 0,
    energyCapacity: s.storeCapacityResource || 300,
    hits: s.hits,
    hitsMax: s.hitsMax,
    spawning: s.spawning ? { name: s.spawning.name, remainingTime: s.spawning.remainingTime } : null
  })),

  // === Extensions ===
  extensions: (() => {
    const exts = db2.getCollection('rooms.objects').find({type: 'extension', room: room, user: uid}).toArray();
    let totalEnergy = 0;
    const positions = [];
    for (const e of exts) {
      totalEnergy += (e.store && e.store.energy) || 0;
      positions.push({x: e.x, y: e.y, energy: (e.store && e.store.energy) || 0});
    }
    return { count: exts.length, totalEnergy, positions };
  })(),

  // === Containers ===
  containers: db2.getCollection('rooms.objects').find({type: 'container', room: room}).toArray().map(c => ({
    x: c.x, y: c.y,
    energy: (c.store && c.store.energy) || 0,
    energyCapacity: c.storeCapacityResource || 2000,
    hits: c.hits,
    hitsMax: c.hitsMax,
    // 判断是否为 source container（紧邻 source）
    isSourceContainer: db2.getCollection('rooms.objects').find({type: 'source', room: room}).toArray()
      .some(s => Math.abs(s.x - c.x) <= 1 && Math.abs(s.y - c.y) <= 1),
    // 判断是否为 controller container
    isControllerContainer: (() => {
      const ctrl = db2.getCollection('rooms.objects').findOne({type: 'controller', room: room, user: uid});
      return ctrl ? (Math.abs(ctrl.x - c.x) <= 1 && Math.abs(ctrl.y - c.y) <= 1) : false;
    })()
  })),

  // === Towers ===
  towers: db2.getCollection('rooms.objects').find({type: 'tower', room: room, user: uid}).toArray().map(t => ({
    x: t.x, y: t.y,
    energy: (t.store && t.store.energy) || 0,
    hits: t.hits, hitsMax: t.hitsMax
  })),

  // === Links ===
  links: db2.getCollection('rooms.objects').find({type: 'link', room: room, user: uid}).toArray().map(l => ({
    x: l.x, y: l.y,
    energy: (l.store && l.store.energy) || 0
  })),

  // === Storage ===
  storage: (() => {
    const s = db2.getCollection('rooms.objects').findOne({type: 'storage', room: room, user: uid});
    if (!s) return null;
    return { x: s.x, y: s.y, energy: (s.store && s.store.energy) || 0 };
  })(),

  // === Roads ===
  roads: (() => {
    const roads = db2.getCollection('rooms.objects').find({type: 'road', room: room, user: uid}).toArray();
    return {
      count: roads.length,
      avgHits: roads.length > 0 ? Math.round(roads.reduce((s, r) => s + r.hits, 0) / roads.length) : 0,
      minHits: roads.length > 0 ? Math.min(...roads.map(r => r.hits)) : 0
    };
  })(),

  // === Ramparts/Walls ===
  defense: (() => {
    const ramparts = db2.getCollection('rooms.objects').find({type: 'rampart', room: room, user: uid}).toArray();
    const walls = db2.getCollection('rooms.objects').find({type: 'constructedWall', room: room, user: uid}).toArray();
    return {
      ramparts: { count: ramparts.length, avgHits: ramparts.length > 0 ? Math.round(ramparts.reduce((s, r) => s + r.hits, 0) / ramparts.length) : 0 },
      walls: { count: walls.length, avgHits: walls.length > 0 ? Math.round(walls.reduce((s, r) => s + r.hits, 0) / walls.length) : 0 }
    };
  })(),

  // === Construction Sites ===
  constructionSites: db2.getCollection('rooms.objects').find({type: 'constructionSite', room: room, user: uid}).toArray().map(s => ({
    structureType: s.structureType,
    x: s.x, y: s.y,
    progress: s.progress,
    progressTotal: s.progressTotal,
    progressPct: Math.round((s.progress / s.progressTotal) * 100)
  })),

  // === Creeps 详细 ===
  creeps: db2.getCollection('rooms.objects').find({type: 'creep', room: room, user: uid}).toArray().map(c => {
    const body = (c.body || []).map(b => b.type);
    const bodyCounts = {};
    for (const p of body) { bodyCounts[p] = (bodyCounts[p] || 0) + 1; }
    return {
      name: c.name,
      role: c.name.split('-')[0],
      x: c.x, y: c.y,
      energy: (c.store && c.store.energy) || 0,
      energyCapacity: c.storeCapacityResource || 0,
      body: bodyCounts,
      bodyParts: body.length,
      hits: c.hits,
      hitsMax: c.hitsMax,
      ticksToLive: c.ticksToLive || 0,
      fatigue: c.fatigue || 0
    };
  }),

  // === 经济汇总 ===
  economy: (() => {
    const spawn = db2.getCollection('rooms.objects').findOne({type: 'spawn', room: room, user: uid});
    const exts = db2.getCollection('rooms.objects').find({type: 'extension', room: room, user: uid}).toArray();
    const containers = db2.getCollection('rooms.objects').find({type: 'container', room: room}).toArray();
    const storage = db2.getCollection('rooms.objects').findOne({type: 'storage', room: room, user: uid});
    const creeps = db2.getCollection('rooms.objects').find({type: 'creep', room: room, user: uid}).toArray();
    const towers = db2.getCollection('rooms.objects').find({type: 'tower', room: room, user: uid}).toArray();

    const spawnE = (spawn && spawn.store && spawn.store.energy) || 0;
    const extE = exts.reduce((s, e) => s + ((e.store && e.store.energy) || 0), 0);
    const containerE = containers.reduce((s, c) => s + ((c.store && c.store.energy) || 0), 0);
    const storageE = (storage && storage.store && storage.store.energy) || 0;
    const creepE = creeps.reduce((s, c) => s + ((c.store && c.store.energy) || 0), 0);
    const towerE = towers.reduce((s, t) => s + ((t.store && t.store.energy) || 0), 0);

    const energyAvailable = spawnE + extE;
    const energyCapacityAvailable = (spawn ? (spawn.storeCapacityResource || 300) : 300) + exts.length * 50;

    return {
      energyAvailable,
      energyCapacityAvailable,
      totalReserve: spawnE + extE + containerE + storageE + creepE + towerE,
      breakdown: {
        spawn: spawnE,
        extensions: extE,
        containers: containerE,
        storage: storageE,
        creeps: creepE,
        towers: towerE
      },
      capacityUtilization: energyCapacityAvailable > 0 ? Math.round((energyAvailable / energyCapacityAvailable) * 100) : 0
    };
  })(),

  // === 人口统计 ===
  population: (() => {
    const creeps = db2.getCollection('rooms.objects').find({type: 'creep', room: room, user: uid}).toArray();
    const byRole = {};
    for (const c of creeps) {
      const role = c.name.split('-')[0];
      if (!byRole[role]) byRole[role] = { count: 0, totalEnergy: 0, totalBodyParts: 0, avgTtl: 0, ttls: [] };
      byRole[role].count++;
      byRole[role].totalEnergy += (c.store && c.store.energy) || 0;
      byRole[role].totalBodyParts += (c.body || []).length;
      byRole[role].ttls.push(c.ticksToLive || 0);
    }
    for (const [role, data] of Object.entries(byRole)) {
      data.avgTtl = Math.round(data.ttls.reduce((a, b) => a + b, 0) / data.ttls.length);
      data.minTtl = Math.min(...data.ttls);
      delete data.ttls;
    }
    return { total: creeps.length, byRole };
  })()
};

print(JSON.stringify(result));
" 2>/dev/null)

  # Redis 采集 Memory 数据
  local memory_data
  memory_data=$(cd "$SERVER_DIR" && docker compose exec -T redis redis-cli get "memory:$UID_VAL" 2>/dev/null | tr -d '\r')

  # 合并 Memory 到快照
  local full_snapshot
  if [ -n "$memory_data" ] && [ "$memory_data" != "null" ]; then
    full_snapshot=$(echo "$mongo_data" | python3 -c "
import sys, json
snapshot = json.loads(sys.stdin.read())
memory = json.loads('''$memory_data''')

# 提取 Memory 中的关键数据
room_mem = memory.get('rooms', {}).get('$ROOM', {})
snapshot['memory'] = {
    'colonyState': room_mem.get('colonyState'),
    'lastRcl': room_mem.get('lastRcl'),
    'phase': room_mem.get('phase'),
    'energyCrisis': room_mem.get('energyCrisis'),
    'layout': {
        'state': room_mem.get('layout', {}).get('state'),
        'anchor': room_mem.get('layout', {}).get('anchor'),
        'revision': room_mem.get('layout', {}).get('revision'),
        'anchorScore': room_mem.get('layout', {}).get('anchorScore'),
        'nextPlanTick': room_mem.get('layout', {}).get('nextPlanTick'),
    },
    'buildQueue': room_mem.get('buildQueue', []),
    'spawnQueue': room_mem.get('spawnQueue', []),
}

# Creep memory 详情
creep_mems = {}
for name, mem in memory.get('creeps', {}).items():
    if '$ROOM' not in name:
        continue
    creep_mems[name] = {
        'role': mem.get('role'),
        'mode': mem.get('mode'),
        'home': mem.get('home'),
        'sourceId': mem.get('sourceId'),
        'stuckTicks': mem.get('stuckTicks', 0),
        'lastPos': mem.get('lastPos'),
        'assignment': mem.get('assignment'),
    }
snapshot['creepMemory'] = creep_mems

# Kernel
snapshot['kernel'] = memory.get('kernel', {})

print(json.dumps(snapshot))
")
  else
    full_snapshot="$mongo_data"
  fi

  echo "$full_snapshot" >> "$OUTPUT_FILE"
  echo "$full_snapshot"
}

# 主循环
for i in $(seq 1 "$COLLECT_COUNT"); do
  echo "--- 采集 #$i / $COLLECT_COUNT ---"
  snapshot=$(collect_snapshot)

  # 提取关键指标用于终端显示
  echo "$snapshot" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
gt = d['meta']['gameTime']
eco = d.get('economy', {})
pop = d.get('population', {})
ctrl = d.get('controller', {})
sites = d.get('constructionSites', [])

print(f'  tick={gt} | RCL={ctrl.get(\"level\",\"?\")} progress={ctrl.get(\"progress\",0)}')
print(f'  reserve={eco.get(\"totalReserve\",0)} (spawn={eco.get(\"breakdown\",{}).get(\"spawn\",0)} ext={eco.get(\"breakdown\",{}).get(\"extensions\",0)} cont={eco.get(\"breakdown\",{}).get(\"containers\",0)} creep={eco.get(\"breakdown\",{}).get(\"creeps\",0)})')
print(f'  pop={pop.get(\"total\",0)}', end='')
for role, info in pop.get('byRole', {}).items():
    print(f' {role}={info[\"count\"]}', end='')
print()
print(f'  sites={len(sites)}', end='')
for s in sites:
    print(f' [{s[\"structureType\"]}@({s[\"x\"]},{s[\"y\"]})={s[\"progressPct\"]}%]', end='')
print()
" 2>/dev/null

  if [ "$i" -lt "$COLLECT_COUNT" ]; then
    sleep "$INTERVAL"
  fi
done

echo ""
echo "=== 采集完成 ==="
echo "数据文件: $OUTPUT_FILE"
echo "总行数: $(wc -l < "$OUTPUT_FILE")"
