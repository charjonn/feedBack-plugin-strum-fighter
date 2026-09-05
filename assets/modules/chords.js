// Strum Fighter — chord dictionary + difficulty tiers + boss progressions.
//
// Slopsmith has no static chord dictionary (chord shapes only exist per-song
// as chart chord_templates), so we ship our own. Fret arrays are ordered
// LOW-E → HIGH-E (string index 0 = low E, MIDI 40), matching the convention
// the desktop engine's scoreChord() expects ({ s, f } where s is that index).
// -1 = muted/not-played; those strings are omitted from the scoreChord notes.

export const CHORDS = {
  // ── Open chords ──
  E:  [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0],
  A:  [-1, 0, 2, 2, 2, 0],
  Am: [-1, 0, 2, 2, 1, 0],
  D:  [-1, -1, 0, 2, 3, 2],
  Dm: [-1, -1, 0, 2, 3, 1],
  G:  [3, 2, 0, 0, 0, 3],
  C:  [-1, 3, 2, 0, 1, 0],
  // ── Barre chords ──
  F:  [1, 3, 3, 2, 1, 1],
  Bm: [-1, 2, 4, 4, 3, 2],
  B:  [-1, 2, 4, 4, 4, 2],
  Fmaj7: [-1, -1, 3, 2, 1, 0],
  // ── Seventh chords ──
  G7:    [3, 2, 0, 0, 0, 1],
  Cmaj7: [-1, 3, 2, 0, 0, 0],
  Am7:   [-1, 0, 2, 0, 1, 0],
  Dm7:   [-1, -1, 0, 2, 1, 1],
  E7:    [0, 2, 0, 1, 0, 0],
  A7:    [-1, 0, 2, 0, 2, 0],
  D7:    [-1, -1, 0, 2, 1, 2],
};

const OPEN    = ['E', 'Em', 'A', 'Am', 'D', 'Dm', 'G', 'C'];
const BARRE   = ['F', 'Bm', 'B', 'Fmaj7'];
const SEVENTH = ['G7', 'Cmaj7', 'Am7', 'Dm7', 'E7', 'A7', 'D7'];

// Boss "armor plates" are real songs' progressions — strum them IN ORDER to
// peel the boss's shields and expose its core. Picked per difficulty so the
// shapes stay inside the player's current pool.
const PROGRESSIONS = {
  easy: [
    { name: 'Drop Anchor',  chords: ['Em', 'C', 'G', 'D'] },
    { name: 'Campfire',     chords: ['G', 'C', 'D'] },
    { name: 'Minor Drift',  chords: ['Am', 'G', 'C'] },
  ],
  medium: [
    { name: 'Ace of Spades', chords: ['E', 'A', 'D', 'A'] },
    { name: 'Iron Wing',     chords: ['Em', 'C', 'G', 'B'] },
    { name: 'Barre Run',     chords: ['F', 'C', 'G', 'Am'] },
  ],
  hard: [
    { name: 'Seventh Heaven', chords: ['Cmaj7', 'Am7', 'Dm7', 'G7'] },
    { name: 'Squadron',       chords: ['F', 'Bm', 'E7', 'A7'] },
    { name: 'Dogfight',       chords: ['B', 'Fmaj7', 'D7', 'G'] },
  ],
};

// chord name → [{ s, f }] for scoreChord (muted strings dropped).
export function toNotes(name) {
  const frets = CHORDS[name];
  if (!frets) return [];
  const notes = [];
  for (let s = 0; s < frets.length; s++) {
    if (frets[s] >= 0) notes.push({ s, f: frets[s] });
  }
  return notes;
}

// The chord pool an enemy wave can draw from, by difficulty.
export function pool(difficulty) {
  if (difficulty === 'hard') return OPEN.concat(BARRE, SEVENTH);
  if (difficulty === 'medium') return OPEN.concat(BARRE);
  return OPEN.slice();
}

// Pick a boss progression for the given difficulty (deterministic-ish via the
// passed RNG so callers can vary it per boss without Math.random reaching here).
export function bossProgression(difficulty, rnd) {
  const list = PROGRESSIONS[difficulty] || PROGRESSIONS.medium;
  // Normalize to [0,1) so out-of-range / non-finite callers don't silently
  // bias toward the first progression.
  const raw = Number.isFinite(rnd) ? rnd : Math.random();
  const r = Math.min(1 - Number.EPSILON, Math.max(0, raw));
  return list[Math.floor(r * list.length)];
}

// Per-tier knobs: detection leniency (scoreChord) + enemy pacing.
// pitchCheckCents: 0 = energy-only (most forgiving); larger = wider pitch
//   tolerance; we keep easy energy-only and tighten as difficulty rises.
// minHitRatio: fraction of chord strings that must ring to count as a hit.
// bossSpeed: boss approach speed (world units/sec). bossShots: SECONDS BETWEEN
// boss shots (a cooldown interval, not a shot count — smaller = more frequent).
export function tierParams(difficulty) {
  // Detection uses the engine's harmonic-comb verifier (the mode note_detect
  // uses for chords) — pitchCheckCents ~50, plus harmonicSnr (harmonic-to-floor
  // ratio to count a string as ringing) and fundamentalRatio (f0-presence
  // gate). Lower harmonicSnr / fundamentalRatio + higher pitchCheckCents +
  // lower minHitRatio = more forgiving.
  switch (difficulty) {
    case 'easy':
      // Very forgiving: ~2 ringing strings of the shape is enough.
      return { pitchCheckCents: 80, minHitRatio: 0.28, harmonicSnr: 2.0, fundamentalRatio: 0.12, enemySpeed: 16, spawnEveryMs: 2700, perWaveBase: 3, perWaveGrow: 1, bossEvery: 3, bossSpeed: 30, bossShots: 1.8 };
    case 'hard':
      return { pitchCheckCents: 50, minHitRatio: 0.50, harmonicSnr: 3.2, fundamentalRatio: 0.22, enemySpeed: 33, spawnEveryMs: 1300, perWaveBase: 5, perWaveGrow: 2, bossEvery: 3, bossSpeed: 46, bossShots: 0.95 };
    case 'medium':
    default:
      return { pitchCheckCents: 65, minHitRatio: 0.34, harmonicSnr: 2.4, fundamentalRatio: 0.15, enemySpeed: 24, spawnEveryMs: 1900, perWaveBase: 4, perWaveGrow: 1, bossEvery: 3, bossSpeed: 38, bossShots: 1.25 };
  }
}

export function waveCount(length) {
  if (length === 'short') return 3;
  if (length === 'long') return 10;
  return 6;
}

// Which waves are boss waves for a run of `total` waves: the final wave is
// always a boss, plus every `bossEvery` waves before it (deduped).
export function bossWaves(total, bossEvery) {
  const every = bossEvery > 0 ? bossEvery : 3;
  const set = new Set([total]);
  for (let w = every; w < total; w += every) set.add(w);
  return set;
}

// ── Chord shapes (for the on-screen diagram) ──────────────────────────────
//
// CHORDS stays a map of plain fret arrays: toNotes() depends on it and
// tests/chords.test.js asserts the shape. Fretting-hand fingers live here in a
// parallel table, aligned 1:1 with CHORDS (LOW-E first):
//   -1 = muted   0 = open (no finger)   1..4 = index/middle/ring/pinky
// A barre is DERIVED, never authored: finger 1 landing on two or more strings
// at the same fret is a bar spanning them.
export const FINGERS = {
  // ── Open chords ──
  E:  [0, 2, 3, 1, 0, 0],
  Em: [0, 2, 3, 0, 0, 0],
  A:  [-1, 0, 1, 2, 3, 0],
  Am: [-1, 0, 2, 3, 1, 0],
  D:  [-1, -1, 0, 1, 3, 2],
  Dm: [-1, -1, 0, 2, 3, 1],
  G:  [2, 1, 0, 0, 0, 3],
  C:  [-1, 3, 2, 0, 1, 0],
  // ── Barre chords ──
  F:  [1, 3, 4, 2, 1, 1],
  Bm: [-1, 1, 3, 4, 2, 1],
  B:  [-1, 1, 2, 3, 4, 1],
  Fmaj7: [-1, -1, 3, 2, 1, 0],
  // ── Seventh chords ──
  G7:    [3, 2, 0, 0, 0, 1],
  Cmaj7: [-1, 3, 2, 0, 0, 0],
  Am7:   [-1, 0, 2, 0, 1, 0],
  Dm7:   [-1, -1, 0, 3, 1, 1],
  E7:    [0, 2, 0, 1, 0, 0],
  A7:    [-1, 0, 2, 0, 3, 0],
  D7:    [-1, -1, 0, 2, 1, 3],
};

// Fret array → [{ s, f }] for scoreChord. Same rule as toNotes(), but fed from
// a raw array so song chord templates (which carry their own frets) can reach
// the scorer without going through the built-in dictionary.
export function notesFromFrets(frets) {
  const notes = [];
  if (!Array.isArray(frets)) return notes;
  for (let s = 0; s < frets.length; s++) {
    if (Number.isInteger(frets[s]) && frets[s] >= 0) notes.push({ s, f: frets[s] });
  }
  return notes;
}

// Everything the diagram renderer needs, derived from frets + fingers.
//
// baseFret is COMPUTED, never authored: a shape that fits inside frets 1-4 is
// drawn against the nut; anything higher shifts the window up and gets an
// "Nfr" caption instead. All 19 built-in chords take the first branch — the
// second exists for song chords further up the neck.
export function shapeFromFrets(name, frets, fingers) {
  if (!Array.isArray(frets) || !frets.length) return null;
  const f = frets.map((v) => (Number.isInteger(v) ? v : -1));
  // Fingers are optional: an unfingered shape still draws, just without digits.
  const src = Array.isArray(fingers) ? fingers : [];
  const fg = f.map((fret, s) => {
    const v = Number.isInteger(src[s]) ? src[s] : (fret < 0 ? -1 : 0);
    // Never let a finger contradict its fret — a muted string has no finger,
    // and an open one has no finger either.
    if (fret < 0) return -1;
    if (fret === 0) return 0;
    return v >= 1 && v <= 4 ? v : 0;
  });

  const fretted = f.filter((v) => v > 0);
  const maxFret = fretted.length ? Math.max(...fretted) : 0;
  const minFret = fretted.length ? Math.min(...fretted) : 0;
  const showNut = !fretted.length || maxFret <= 4;
  const baseFret = showNut ? 1 : minFret;
  const fretWindow = Math.max(4, maxFret - baseFret + 1);

  // Barre: the LOWEST fret at which finger 1 holds down two or more strings.
  let barre = null;
  const byFret = new Map();
  for (let s = 0; s < f.length; s++) {
    if (fg[s] !== 1 || f[s] <= 0) continue;
    if (!byFret.has(f[s])) byFret.set(f[s], []);
    byFret.get(f[s]).push(s);
  }
  for (const fret of [...byFret.keys()].sort((a, b) => a - b)) {
    const ss = byFret.get(fret);
    if (ss.length >= 2) { barre = { fret, fromS: Math.min(...ss), toS: Math.max(...ss), finger: 1 }; break; }
  }

  const dots = [];
  for (let s = 0; s < f.length; s++) {
    if (f[s] <= 0) continue;
    const inBarre = !!(barre && fg[s] === 1 && f[s] === barre.fret);
    dots.push({ s, fret: f[s], finger: fg[s], inBarre });
  }

  return {
    name: name || '',
    frets: f,
    fingers: fg,
    baseFret,
    fretWindow,
    span: fretted.length ? maxFret - minFret + 1 : 0,
    showNut,
    muted: f.map((v, s) => (v < 0 ? s : -1)).filter((s) => s >= 0),
    open: f.map((v, s) => (v === 0 ? s : -1)).filter((s) => s >= 0),
    dots,
    barre,
  };
}

// Shape for a chord in the built-in dictionary.
export function shapeOf(name) {
  const frets = CHORDS[name];
  if (!frets) return null;
  return shapeFromFrets(name, frets, FINGERS[name]);
}
