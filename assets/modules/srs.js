// Strum Fighter — spaced repetition over the active chord set.
//
// Enemies used to carry a uniformly random chord, so the chords you already
// know came up exactly as often as the ones you keep fumbling. This schedules
// them instead: miss a chord and it comes back soon and often; land it cleanly
// several times and it fades into the background.
//
// A run is a continuous stream of spawns, not a daily review session, so the
// clock here is the SPAWN TICK and the model is Leitner boxes with weighted
// selection — not a date-based SM-2. Real dates are used for one thing only:
// decaying boxes between runs, so a profile left alone for a month cannot go
// on claiming mastery.
//
// No DOM: storage is injected, so the whole module is unit-testable in Node.

export const SRS_VERSION = 1;
export const BOXES = 5;                      // boxes 0..4
export const INTERVAL = [1, 2, 4, 8, 16];    // ticks until a box-b chord is due

const PROMOTE_Q = 0.6;    // score below this only promotes on a 2-streak
const DEMOTE_STEP = 2;    // a miss costs more than a hit earns, deliberately
const NEW_BONUS = 2.5;    // seed unseen chords early
const LAPSE_W = 0.8;      // chords you keep losing stay in rotation
const EPS = 0.05;         // a mastered chord still turns up occasionally
const MAX_DUE_W = 5;      // cap so a never-answered chord can't dominate
const DECAY_DAYS = 10;    // one box lost per this many idle days
const MAX_CHORDS = 96;    // entries kept per key
const MAX_BYTES = 16384;  // serialized ceiling per key

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function blankState() {
  return {
    box: 0, seen: 0, hits: 0, misses: 0, streak: 0, lapses: 0,
    avgScore: null, lastTick: 0, dueTick: 0, startBox: 0,
  };
}

// ── Storage adapters ──────────────────────────────────────────────────────
// Interface: { get(k), set(k, v), remove(k) }, any of which may be async and
// none of which may throw — a failed store degrades to "no history", never to
// a broken run.

export function memoryAdapter() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v) { m.set(k, v); return true; },
    async remove(k) { m.delete(k); },
  };
}

// Returns null when storage is unusable (private window, disabled site data,
// a partitioned webview) so the caller can fall back rather than guess.
export function localStorageAdapter(ns, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  let ls = null;
  try {
    ls = w && w.localStorage;
    const probe = (ns || 'srs') + ':__probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
  } catch (_e) {
    return null;
  }
  const pre = (k) => `${ns}:${k}`;
  return {
    async get(k) { try { return ls.getItem(pre(k)); } catch (_e) { return null; } },
    async set(k, v) { try { ls.setItem(pre(k), v); return true; } catch (_e) { return false; } },
    async remove(k) { try { ls.removeItem(pre(k)); } catch (_e) {} },
  };
}

// Writes to both, reads primary then secondary. Whichever store turns out to
// be real carries the data, so we never have to be sure in advance which one
// works in this host.
export function dualAdapter(primary, secondary) {
  if (!primary && !secondary) return memoryAdapter();
  if (!primary) return secondary;
  if (!secondary) return primary;
  return {
    async get(k) {
      const a = await primary.get(k);
      if (a != null) return a;
      return secondary.get(k);
    },
    async set(k, v) {
      const a = await primary.set(k, v);
      const b = await secondary.set(k, v);
      return !!(a || b);
    },
    async remove(k) { await primary.remove(k); await secondary.remove(k); },
  };
}

// ── Scheduler ─────────────────────────────────────────────────────────────

export function createSrs(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const rng = typeof o.rng === 'function' ? o.rng : Math.random;
  const storage = o.storage || null;
  const key = o.key || 'default';

  let active = Array.isArray(o.chords) ? o.chords.slice() : [];
  const states = new Map();
  let tick = 0;
  let lastPicked = null;
  let sinceSave = 0;
  let lastSaveAt = 0;

  function stateOf(name) {
    return states.has(name) ? states.get(name) : null;
  }
  function ensure(name) {
    if (!states.has(name)) states.set(name, blankState());
    return states.get(name);
  }

  function mastery(name) {
    const st = stateOf(name);
    if (!st || st.seen === 0) return 0;
    return clamp01(0.7 * (st.box / (BOXES - 1)) + 0.3 * (st.avgScore || 0));
  }

  // A chord sitting in box 0 that has fallen back more than once: the shape
  // is not sticking, so the game should stop being subtle about it.
  function isLeech(name) {
    const st = stateOf(name);
    return !!(st && st.box === 0 && st.lapses >= 2);
  }

  function weightOf(name) {
    const st = ensure(name);
    const overdue = Math.max(0, tick - st.dueTick);
    const boxW = (BOXES - st.box) / BOXES;                          // 1.0 → 0.2
    const dueW = 1 + Math.min(overdue / INTERVAL[st.box], MAX_DUE_W);
    const newW = st.seen === 0 ? NEW_BONUS : 1;
    const errW = 1 + LAPSE_W * Math.min(1, st.lapses / 3);
    return EPS + boxW * dueW * newW * errW;
  }

  function weights() {
    return active.map((name) => ({ name, w: weightOf(name) }));
  }

  function pick(rnd) {
    if (!active.length) return null;
    // Never the same chord twice running — that is a stutter, not practice.
    const pool = active.length > 1 ? active.filter((c) => c !== lastPicked) : active;
    const ws = pool.map(weightOf);
    const total = ws.reduce((a, b) => a + b, 0);
    const r = (Number.isFinite(rnd) ? clamp01(rnd) : clamp01(rng())) * total;
    let acc = 0, chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      acc += ws[i];
      if (r < acc) { chosen = pool[i]; break; }
    }
    tick++;
    lastPicked = chosen;
    return chosen;
  }

  function record(name, result) {
    if (!name) return null;
    const st = ensure(name);
    const isHit = !!(result && result.isHit);
    const raw = result && result.score;
    const q = clamp01(Number.isFinite(raw) ? raw : (isHit ? 1 : 0));

    st.seen++;
    st.lastTick = tick;
    st.avgScore = st.avgScore == null ? q : st.avgScore + (q - st.avgScore) * 0.3;

    if (isHit) {
      st.hits++;
      st.streak++;
      // A clean hit promotes; a scrappy one has to be repeated, so barely
      // scraping through never reads as mastery.
      if (q >= PROMOTE_Q || st.streak >= 2) st.box = Math.min(BOXES - 1, st.box + 1);
    } else {
      st.misses++;
      st.streak = 0;
      if (st.box > 0) st.lapses++;
      st.box = Math.max(0, st.box - DEMOTE_STEP);
    }
    st.dueTick = tick + INTERVAL[st.box];
    sinceSave++;
    return st;
  }

  // Autosave hook: the plugin spec forbids synchronous storage on a gameplay
  // path, so the caller checks this occasionally rather than writing per strum.
  function shouldSave() {
    return sinceSave >= 25 || (sinceSave > 0 && now() - lastSaveAt > 30000);
  }

  function snapshot() {
    const c = {};
    for (const [name, st] of states) {
      if (st.seen === 0) continue; // nothing learned, nothing worth storing
      c[name] = [st.box, st.lastTick, st.hits, st.misses, st.streak, st.lapses,
        st.avgScore == null ? -1 : Math.round(st.avgScore * 100)];
    }
    return { v: SRS_VERSION, key, tick, savedAt: now(), c };
  }

  // Keep the payload small: drop the best-known chords first (they are the
  // least useful history), then the stalest, until it fits.
  function trim(payload) {
    const names = Object.keys(payload.c);
    if (names.length > MAX_CHORDS) {
      names.sort((a, b) => {
        const A = payload.c[a], B = payload.c[b];
        if (B[0] !== A[0]) return B[0] - A[0];   // highest box first
        return A[1] - B[1];                      // then stalest
      });
      for (const n of names.slice(0, names.length - MAX_CHORDS)) delete payload.c[n];
    }
    let json = JSON.stringify(payload);
    while (json.length > MAX_BYTES) {
      const left = Object.keys(payload.c);
      if (!left.length) break;
      left.sort((a, b) => payload.c[b][0] - payload.c[a][0]);
      delete payload.c[left[0]];
      json = JSON.stringify(payload);
    }
    return json;
  }

  async function save() {
    if (!storage) return false;
    try {
      const ok = await storage.set(key, trim(snapshot()));
      sinceSave = 0;
      lastSaveAt = now();
      return !!ok;
    } catch (_e) {
      return false;
    }
  }

  async function hydrate() {
    lastSaveAt = now();
    if (!storage) return false;
    let raw = null;
    try {
      raw = await storage.get(key);
    } catch (_e) {
      return false;
    }
    if (!raw) return false;
    let payload = null;
    try {
      payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_e) {
      return false;
    }
    // A payload from another schema is discarded, not migrated: guessing at
    // old data is worse than starting clean.
    if (!payload || payload.v !== SRS_VERSION || !payload.c) return false;

    const idleDays = Math.max(0, (now() - (payload.savedAt || 0)) / 864e5);
    const decay = Math.floor(idleDays / DECAY_DAYS);
    for (const [name, packed] of Object.entries(payload.c)) {
      if (!Array.isArray(packed) || packed.length < 6) continue;
      const st = ensure(name);
      st.box = Math.max(0, Math.min(BOXES - 1, (packed[0] | 0) - decay));
      st.lastTick = packed[1] | 0;
      st.hits = packed[2] | 0;
      st.misses = packed[3] | 0;
      st.streak = packed[4] | 0;
      st.lapses = packed[5] | 0;
      const q = packed.length > 6 ? packed[6] : -1;
      st.avgScore = q < 0 ? null : q / 100;
      st.seen = st.hits + st.misses;
      // dueTick is derived rather than stored — one less field to keep true.
      st.dueTick = st.lastTick + INTERVAL[st.box];
      st.startBox = st.box;
    }
    tick = Math.max(0, payload.tick | 0);
    return true;
  }

  // ── Reporting ──
  function seenList() {
    return active
      .map((name) => ({ name, st: stateOf(name) }))
      .filter((e) => e.st && e.st.seen > 0);
  }

  function weakest(n) {
    return seenList()
      .map((e) => ({
        name: e.name, box: e.st.box, hits: e.st.hits, misses: e.st.misses,
        seen: e.st.seen, avgScore: e.st.avgScore, mastery: mastery(e.name),
      }))
      .sort((a, b) => a.mastery - b.mastery || b.misses - a.misses)
      .slice(0, n || 3);
  }

  function movement() {
    let mastered = 0, learning = 0, slipped = 0;
    for (const { name, st } of seenList()) {
      if (st.box >= BOXES - 1) mastered++;
      else if (st.box < st.startBox) slipped++;
      else learning++;
      void name;
    }
    return { mastered, learning, slipped };
  }

  function table() {
    return seenList()
      .map((e) => ({
        name: e.name, box: e.st.box, seen: e.st.seen, hits: e.st.hits,
        misses: e.st.misses, avgScore: e.st.avgScore, mastery: mastery(e.name),
      }))
      .sort((a, b) => a.mastery - b.mastery || b.seen - a.seen);
  }

  return {
    hydrate, pick, record, stateOf, mastery, isLeech, weights,
    weakest, movement, table, snapshot, save, shouldSave,
    tick: () => tick,
    size: () => states.size,
    setChords(list) { active = Array.isArray(list) ? list.slice() : []; lastPicked = null; },
    chords: () => active.slice(),
  };
}
