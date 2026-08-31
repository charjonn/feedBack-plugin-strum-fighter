// Strum Fighter — reading chords out of the player's own song library.
//
// The game is chart-free by design, but "chart-free" only ever meant it does
// not need a chart to RUN. The host exposes the library over its ordinary
// same-origin HTTP API, so a player can drill the chords of a song they are
// actually learning instead of a generic difficulty pool.
//
//   GET /api/library                 → the song list (filename, title, tuning…)
//   ws  /ws/highway/{filename}       → the chart, including chord_templates
//
// A chord template carries its own frets AND fingers:
//
//   { name: 'Em7', frets: [0,2,2,0,0,0], fingers: [-1,2,1,-1,-1,-1] }
//
// which is exactly what scoreChord and the diagram renderer each want. So a
// song chord never has to be matched against the built-in dictionary — we play
// and draw the voicing the song itself specifies, and the name is only a label.
//
// Everything here fails soft: any network problem, an empty library, or a song
// whose chart carries no usable shapes leaves the caller with nothing and the
// game falls back to its difficulty pool.

const LIST_SIZE = 100;
const CHART_TIMEOUT_MS = 20000;

// ── Pure helpers ──────────────────────────────────────────────────────────

// Standard tuning, or near enough that the built-in shapes still apply. The
// host reports offsets as a comma string; empty means "no offsets recorded".
export function isStandardTuning(song) {
  const raw = song && song.tuning_offsets;
  if (raw == null || raw === '') return true;
  const parts = String(raw).split(',').map((v) => parseInt(v, 10));
  return parts.every((v) => Number.isFinite(v) && v === 0);
}

// A template is usable only if we can name it and actually play it. Guitar Pro
// imports routinely emit a blank name and all -1 frets; those are dropped
// rather than turned into unplayable enemies.
export function isUsableTemplate(tpl) {
  if (!tpl) return false;
  const name = (tpl.displayName || tpl.name || '').trim();
  if (!name) return false;
  if (!Array.isArray(tpl.frets) || tpl.frets.length < 4) return false;
  const played = tpl.frets.filter((f) => Number.isInteger(f) && f >= 0);
  return played.length >= 2;
}

export function templateName(tpl) {
  return String((tpl.displayName || tpl.name || '')).trim();
}

// The song's chords in playing order, repeats collapsed. Sorted by time
// because the wire delivers `chords` in batches with no ordering guarantee.
export function progressionOf(chart) {
  if (!chart || !Array.isArray(chart.chords) || !Array.isArray(chart.templates)) return [];
  const out = [];
  const ordered = chart.chords
    .filter((c) => c && Number.isFinite(c.t))
    .slice()
    .sort((a, b) => a.t - b.t);
  for (const c of ordered) {
    const tpl = chart.templates[c.id];
    if (!isUsableTemplate(tpl)) continue;
    const name = templateName(tpl);
    // Holding one chord across several beats is one chord, not several.
    if (out.length && out[out.length - 1].name === name) continue;
    out.push({
      t: c.t,
      name,
      frets: tpl.frets.slice(),
      fingers: Array.isArray(tpl.fingers) ? tpl.fingers.slice() : null,
    });
  }
  return out;
}

// Unique chords, in order of first appearance.
//
// Keyed by NAME rather than by voicing: a song that spells the same chord two
// ways would otherwise split into two separate things to learn, and the first
// voicing is the one the player meets. Two genuinely different chords never
// share a name, so nothing is lost.
export function chordSetOf(prog) {
  const seen = new Map();
  for (const c of prog || []) {
    if (!seen.has(c.name)) {
      seen.set(c.name, { name: c.name, frets: c.frets.slice(), fingers: c.fingers ? c.fingers.slice() : null });
    }
  }
  return [...seen.values()];
}

// A slice of the real progression for a boss's shield plates. Successive
// bosses in one run drill successive slices, so a long song is not reduced to
// its first four chords.
export function bossSliceOf(prog, occurrence, maxPlates) {
  const cap = maxPlates > 0 ? maxPlates : 6;
  const names = [];
  for (const c of prog || []) {
    if (!names.length || names[names.length - 1] !== c.name) names.push(c.name);
  }
  if (!names.length) return null;
  // A boss needs at least three plates; a short song cycles round to fill them.
  const base = names.slice();
  while (names.length < 3) names.push(base[names.length % base.length]);
  // Successive bosses in one run drill successive slices, so a long song is
  // not reduced to its opening bars.
  const start = names.length > cap ? (Math.max(0, occurrence | 0) * cap) % names.length : 0;
  const take = Math.min(cap, names.length);
  const out = [];
  for (let i = 0; i < take; i++) out.push(names[(start + i) % names.length]);
  return out;
}

// ── Host API ──────────────────────────────────────────────────────────────

function pickArrangement(song) {
  const arr = song && song.arrangements;
  if (!Array.isArray(arr) || !arr.length) return -1;
  // Prefer a guitar part over bass/drums when the host names them.
  const guitar = arr.findIndex((a) => /lead|rhythm|guitar/i.test(String(a && (a.name || a) || '')));
  return guitar >= 0 ? guitar : 0;
}

// The songs worth offering: playable in standard tuning, favourites first,
// then most recent. Capped, because the host renders the track picker as a
// flat row of buttons.
export async function listSongs(opts) {
  const o = opts || {};
  const doFetch = o.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const limit = o.limit > 0 ? o.limit : 12;
  if (!doFetch) return [];

  async function page(query) {
    try {
      const r = await doFetch(`/api/library?${query}`);
      if (!r || !r.ok) return [];
      const body = await r.json();
      return Array.isArray(body && body.songs) ? body.songs : [];
    } catch (_e) {
      return [];
    }
  }

  const favourites = await page(`favorites=1&size=${LIST_SIZE}&provider=local`);
  const recent = await page(`sort=mtime&dir=desc&size=${LIST_SIZE}&provider=local`);

  const out = [];
  const seen = new Set();
  for (const s of favourites.concat(recent)) {
    if (!s || !s.filename || seen.has(s.filename)) continue;
    if (!isStandardTuning(s)) continue;
    seen.add(s.filename);
    out.push({
      id: s.filename,
      filename: s.filename,
      title: s.title || s.filename,
      artist: s.artist || '',
      arrangement: pickArrangement(s),
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Pull one song's chart off the highway socket.
//
// This streams the whole chart — notes, lyrics, notation, the lot — because
// that socket exists for the highway renderer, not for chord lookup. It is
// therefore done exactly once, at run start, never in the game loop.
export function loadChart(song, opts) {
  const o = opts || {};
  const WS = o.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  const loc = o.location || (typeof location !== 'undefined' ? location : null);
  const timeoutMs = o.timeoutMs > 0 ? o.timeoutMs : CHART_TIMEOUT_MS;

  return new Promise((resolve) => {
    if (!WS || !loc || !song || !song.filename) return resolve(null);
    let ws = null, done = false, timer = null;
    const out = { info: null, templates: [], chords: [] };

    const finish = (value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try { if (ws) ws.close(); } catch (_e) {}
      resolve(value);
    };

    try {
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const arr = song.arrangement != null ? song.arrangement : -1;
      // Encode each path SEGMENT, keeping the separators: a filename is a
      // DLC-relative path, and real ones carry characters that would otherwise
      // end the URL early — "Song #1" would truncate at the '#', and
      // "Where Is My Mind?" would start a query string. The server would then
      // be asked for a different song, and the track would silently fall back
      // to the generic pool.
      const path = String(song.filename).split('/').map(encodeURIComponent).join('/');
      ws = new WS(`${proto}//${loc.host}/ws/highway/${path}?arrangement=${arr}`);
    } catch (_e) {
      return resolve(null);
    }

    timer = setTimeout(() => finish(null), timeoutMs);

    ws.onerror = () => finish(null);
    ws.onclose = () => finish(out.templates.length ? out : null);
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch (_e) { return; }
      if (!m) return;
      if (m.error) return finish(null);
      switch (m.type) {
        case 'song_info': out.info = m; break;
        case 'chord_templates': out.templates = Array.isArray(m.data) ? m.data : []; break;
        // `chords` arrives batched, so accumulate rather than assign.
        case 'chords': if (Array.isArray(m.data)) out.chords.push(...m.data); break;
        case 'ready': finish(out); break;
        default: break;
      }
    };
  });
}

// Everything a run needs from one song, or null if it carries nothing playable.
export async function loadSong(song, opts) {
  const chart = await loadChart(song, opts);
  if (!chart) return null;
  const progression = progressionOf(chart);
  const chords = chordSetOf(progression);
  // One chord is not a drill, and the scheduler's no-repeat rule needs two.
  if (chords.length < 2) return null;
  return {
    id: song.id || song.filename,
    title: song.title,
    artist: song.artist || '',
    progression,
    chords,
  };
}
