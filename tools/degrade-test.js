const PART = { move: 50, work: 100, carry: 50, attack: 80, ranged_attack: 150, heal: 250, claim: 600, tough: 10 };
const cost = (b) => b.reduce((s, p) => s + PART[p], 0);
function degrade(body, energy, req) {
  req = req || ["carry", "move"];
  const parts = [...body];
  while (cost(parts) > energy) {
    const counts = new Map();
    for (const p of parts) counts.set(p, (counts.get(p) || 0) + 1);
    let wi = -1, wc = -1;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], c = PART[p];
      if (c < wc) continue;
      const isReq = req.includes(p);
      if (isReq && (counts.get(p) || 0) <= 1) continue;
      wi = i; wc = c;
    }
    if (wi === -1) break;
    parts.splice(wi, 1);
  }
  for (const p of req) if (!parts.includes(p)) return undefined;
  if (cost(parts) > energy) return undefined;
  return parts;
}
const tmpl = [];
for (let i = 0; i < 16; i++) tmpl.push("carry");
for (let i = 0; i < 8; i++) tmpl.push("move");
for (const e of [300, 409, 450, 550, 650, 800]) {
  const b = degrade(tmpl, e);
  if (!b) { console.log("energy", e, "-> undefined"); continue; }
  const c = b.filter((p) => p === "carry").length;
  const m = b.filter((p) => p === "move").length;
  console.log("energy", e, "-> " + c + "C" + m + "M cost=" + cost(b) + " C/M=" + (c / m).toFixed(1) + (m < c / 2 ? "  MOVE不足-满载爬行" : ""));
}
