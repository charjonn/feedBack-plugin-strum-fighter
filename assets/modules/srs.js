// Strum Fighter — spaced repetition over the chord grips you are learning.
//
// Enemies used to carry a uniformly random chord, so the chords you already
// know came up exactly as often as the ones you keep fumbling. This schedules
// them instead: miss a grip and it comes back soon and often; land it cleanly
// several times and it fades into the background.
//
// Knowledge is keyed by the GRIP — the fret positions — not by the chord's
// name and not by the song it appeared in. A grip is what your hand actually
// learns, so:
//
//   * the same shape in another song carries its history straight over;
//   * an open C and a barre C at the third fret stay separate, because they
//     genuinely are two different things to learn;
//   * "Em7" and "E minor 7" merge on their own when the frets match, with no
//     name table to maintain.
//
// A run is a continuous stream of spawns rather than a daily review session,
// so the clock here is the SPAWN TICK and the model is Leitner boxes with
// weighted selection, not a date-based SM-2. Real dates are used for exactly
// one thing: decaying boxes between runs, so a profile left alone for a month
// cannot go on claiming mastery.
//
// No DOM: storage is injected, so the whole module is unit-testable in Node.

export const SRS_VERSION = 2;
export const BOXES = 5;                      // boxes 0..4
export const INTERVAL = [1, 2, 4, 8, 16];    // ticks until a box-b grip is due

const PROMOTE_Q = 0.6;    // score below this only promotes on a 2-streak
const DEMOTE_STEP = 2;    // a miss costs more than a hit earns, deliberately
const NEW_BONUS = 2.5;    // seed unseen grips early
const LAPSE_W = 0.8;      // grips you keep losing stay in rotation
const EPS = 0.05;         // a mastered grip still turns up occasionally
const MAX_DUE_W = 5;      // cap so a never-answered grip can't dominate
const DECAY_DAYS = 10;    // one box lost per this many idle days
const MAX_CHORDS = 256;   // entries kept (one shared set now, so room for more)
const MAX_BYTES = 131072; // serialized ceiling

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// The identity of a chord, for learning purposes.
export function gripKey(frets) {
  return Array.isArray(frets) ? frets.join(',') : '';
}

function blankState(name) {
  return {
    name: name || '',
    box: 0, seen: 0, hits: 0, misses: 0, streak: 0, lapses: 0,
    avgScore: null, lastTick: 0, dueTick: 0, startBox: 0,
    // Counted for THIS run only, never restored from storage: the end-of-run
    // report is about the run, and mixing lifetime totals into it alongside
    // session-only timings reads as one set of numbers when it is two.
    runSeen: 0, runHits: 0, runMisses: 0,
  };
}

// ── Storage adapters ──────────────────────────────────────────────────────
// Interface: { get(k), set(k, v), remove(k) }, any of which may be async and
// none of which may throw — a failed store degrades to "no history", never to
// a broken run. What it must NOT do is fail silently at the game level; the
// caller checks save()'s return value and tells the player.

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
//
// Worth knowing: in at least one real feedBack build this probe passes and
// reads still come back empty, which is why it is no longer the only store.
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

// The plugin's own backend (routes.py), on the same origin that already
// serves these modules. This is the store that actually has to work.
export function httpAdapter(pluginId, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return null;
  const url = `/api/plugins/${pluginId || 'strum_fighter'}/progress`;
  return {
    async get() {
      try {
        const r = await doFetch(url);
        if (!r || !r.ok) return null;
        const body = await r.json();
        // An empty object is "no history yet", which is not the same as a
        // failed read — but for our purposes both mean "start fresh".
        if (!body || typeof body !== 'object' || !Object.keys(body).length) return null;
        return JSON.stringify(body);
      } catch (_e) {
        return null;
      }
    },
    async set(k, v) {
      try {
        const r = await doFetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: typeof v === 'string' ? v : JSON.stringify(v),
        });
        return !!(r && r.ok);
      } catch (_e) {
        return false;
      }
    },
    async remove() {
      try { await doFetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch (_e) {}
    },
  };
}

// Writes to both, reads primary then secondary. Whichever store turns out to
// be real carries the data, so the game never has to be sure in advance which
// one works in this host.
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
      // Saved if EITHER store took it — but not if both refused, because then
      // nothing was really saved and the player needs to hear about it.
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
  const storeKey = o.storeKey || 'chords';

  // The active set is [{ key, name }] — key is the grip, name is for display.
  let active = normalizeSet(o.chords);
  const states = new Map();
  let tick = 0;
  let lastPicked = null;
  let sinceSave = 0;
  let lastSaveAt = 0;

  function normalizeSet(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const c of list) {
      if (!c) continue;
      const key = typeof c === 'string' ? c : c.key;
      if (!key) continue;
      out.push({ key, name: (typeof c === 'string' ? c : c.name) || key });
    }
    return out;
  }

  function stateOf(key) {
    return states.has(key) ? states.get(key) : null;
  }
  function ensure(key, name) {
    // The active set knows what this grip is called, so a caller does not have
    // to pass the name along on every record().
    const label = name || (active.find((c) => c.key === key) || {}).name || '';
    if (!states.has(key)) states.set(key, blankState(label === key ? '' : label));
    const st = states.get(key);
    // A grip first met in another song already has a name; a better one may
    // arrive later, and a name is better than the raw grip.
    if (label && label !== key && !st.name) st.name = label;
    return st;
  }

  function nameOf(key) {
    const st = stateOf(key);
    if (st && st.name) return st.name;
    const inSet = active.find((c) => c.key === key);
    return inSet ? inSet.name : key;
  }

  function mastery(key) {
    const st = stateOf(key);
    if (!st || st.seen === 0) return 0;
    return clamp01(0.7 * (st.box / (BOXES - 1)) + 0.3 * (st.avgScore || 0));
  }

  // A grip sitting in box 0 that has fallen back more than once: the shape is
  // not sticking, so the game should stop being subtle about it.
  function isLeech(key) {
    const st = stateOf(key);
    return !!(st && st.box === 0 && st.lapses >= 2);
  }

  function weightOf(key, name) {
    const st = ensure(key, name);
    const overdue = Math.max(0, tick - st.dueTick);
    const boxW = (BOXES - st.box) / BOXES;                          // 1.0 → 0.2
    const dueW = 1 + Math.min(overdue / INTERVAL[st.box], MAX_DUE_W);
    const newW = st.seen === 0 ? NEW_BONUS : 1;
    const errW = 1 + LAPSE_W * Math.min(1, st.lapses / 3);
    return EPS + boxW * dueW * newW * errW;
  }

  function weights() {
    return active.map((c) => ({ name: c.name, key: c.key, w: weightOf(c.key, c.name) }));
  }

  // Returns a grip KEY; the caller maps it back to a playable chord.
  function pick(rnd) {
    if (!active.length) return null;
    // Never the same grip twice running — that is a stutter, not practice.
    const pool = active.length > 1 ? active.filter((c) => c.key !== lastPicked) : active;
    const ws = pool.map((c) => weightOf(c.key, c.name));
    const total = ws.reduce((a, b) => a + b, 0);
    const r = (Number.isFinite(rnd) ? clamp01(rnd) : clamp01(rng())) * total;
    let acc = 0, chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      acc += ws[i];
      if (r < acc) { chosen = pool[i]; break; }
    }
    tick++;
    lastPicked = chosen.key;
    return chosen.key;
  }

  function record(key, result) {
    if (!key) return null;
    const st = ensure(key, result && result.name);
    const isHit = !!(result && result.isHit);
    const raw = result && result.score;
    const q = clamp01(Number.isFinite(raw) ? raw : (isHit ? 1 : 0));

    st.seen++;
    st.runSeen++;
    st.lastTick = tick;
    st.avgScore = st.avgScore == null ? q : st.avgScore + (q - st.avgScore) * 0.3;

    if (isHit) {
      st.hits++;
      st.runHits++;
      st.streak++;
      // A clean hit promotes; a scrappy one has to be repeated, so barely
      // scraping through never reads as mastery.
      if (q >= PROMOTE_Q || st.streak >= 2) st.box = Math.min(BOXES - 1, st.box + 1);
    } else {
      st.misses++;
      st.runMisses++;
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
    for (const [key, st] of states) {
      if (st.seen === 0) continue; // nothing learned, nothing worth storing
      c[key] = [st.box, st.lastTick, st.hits, st.misses, st.streak, st.lapses,
        st.avgScore == null ? -1 : Math.round(st.avgScore * 100), st.name || ''];
    }
    return { v: SRS_VERSION, tick, savedAt: now(), c };
  }

  // Keep the payload small: drop the best-known grips first (they are the
  // least useful history), then the stalest, until it fits.
  function trim(payload) {
    const keys = Object.keys(payload.c);
    if (keys.length > MAX_CHORDS) {
      keys.sort((a, b) => {
        const A = payload.c[a], B = payload.c[b];
        if (B[0] !== A[0]) return B[0] - A[0];   // highest box first
        return A[1] - B[1];                      // then stalest
      });
      for (const n of keys.slice(0, keys.length - MAX_CHORDS)) delete payload.c[n];
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

  // Returns whether the write actually landed. The caller is expected to show
  // this: progress vanishing without a word is the bug this replaced.
  async function save() {
    if (!storage) return false;
    try {
      const ok = await storage.set(storeKey, trim(snapshot()));
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
      raw = await storage.get(storeKey);
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
    for (const [key, packed] of Object.entries(payload.c)) {
      if (!Array.isArray(packed) || packed.length < 6) continue;
      const st = ensure(key, packed.length > 7 ? packed[7] : '');
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
  //
  // Scoped to what was actually played this run. Restored history still sets
  // the box each grip stands in — that is the point of remembering it — but a
  // run summary should not list chords the player never met, nor count last
  // week's attempts among this session's.
  function seenList() {
    return active
      .map((c) => ({ key: c.key, name: nameOf(c.key), st: stateOf(c.key) }))
      .filter((e) => e.st && e.st.runSeen > 0);
  }

  function weakest(n) {
    return seenList()
      .map((e) => ({
        name: e.name, key: e.key, box: e.st.box, hits: e.st.runHits, misses: e.st.runMisses,
        seen: e.st.runSeen, avgScore: e.st.avgScore, mastery: mastery(e.key),
      }))
      .sort((a, b) => a.mastery - b.mastery || b.misses - a.misses)
      .slice(0, n || 3);
  }

  function movement() {
    let mastered = 0, learning = 0, slipped = 0;
    for (const { st } of seenList()) {
      if (st.box >= BOXES - 1) mastered++;
      else if (st.box < st.startBox) slipped++;
      else learning++;
    }
    return { mastered, learning, slipped };
  }

  function table() {
    return seenList()
      .map((e) => ({
        name: e.name, key: e.key, box: e.st.box, seen: e.st.runSeen, hits: e.st.runHits,
        misses: e.st.runMisses, avgScore: e.st.avgScore, mastery: mastery(e.key),
      }))
      .sort((a, b) => a.mastery - b.mastery || b.seen - a.seen);
  }

  return {
    hydrate, pick, record, stateOf, mastery, isLeech, weights, nameOf,
    weakest, movement, table, snapshot, save, shouldSave,
    tick: () => tick,
    size: () => states.size,
    setChords(list) { active = normalizeSet(list); lastPicked = null; },
    chords: () => active.map((c) => ({ key: c.key, name: c.name })),
  };
}
