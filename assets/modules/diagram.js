// Strum Fighter — chord-box diagrams, drawn a piece at a time.
//
// The game used to show only a chord's NAME, which drills recall but never
// teaches the grip. This module draws the shape itself, and draws it
// PROGRESSIVELY: at reveal 0 nothing, then the grid and the played/muted
// markers as scaffolding, then the fretted dots one at a time. So you get a
// beat to remember the chord yourself, and the answer arrives only if you
// needed it.
//
// Reveal order is LOW-E → HIGH-E, matching toNotes() in chords.js and the
// low-to-high stagger of the chord cue in synth.js — the order you actually
// place and strum the shape.
//
// The reveal unit is a fretted DOT, not a string column. Column-wise on
// D [-1,-1,0,2,3,2] the first three steps would show "x x o" — no information
// at all — and then drop all three dots at once. Per-dot reveal also makes the
// granularity scale with the shape: F reveals over 6 steps, D over 3.
//
// Split deliberately: layoutChord/revealPlan/boxHeight are pure geometry and
// unit-tested in Node; only drawChord touches a canvas.

const SCAFFOLD_AT = 0.08; // below this, draw nothing at all

// ── Pure geometry ─────────────────────────────────────────────────────────

// Height a box of width `w` needs for this shape's fret window.
export function boxHeight(shape, w) {
  const rows = shape && shape.fretWindow > 0 ? shape.fretWindow : 4;
  return w * (0.26 + 0.26 * rows);
}

// Absolute-pixel primitives for one chord box. Reveal-free, so callers can
// memoize it per (name, width, lefty) and vary the reveal every frame.
export function layoutChord(shape, box) {
  if (!shape || !box) return null;
  const rows = shape.fretWindow > 0 ? shape.fretWindow : 4;
  const x = box.x, y = box.y, w = box.w;
  const h = box.h != null ? box.h : boxHeight(shape, w);
  const lefty = !!box.lefty;

  const padX = w * 0.14;
  const padTop = h * 0.16;
  const padBottom = h * 0.04;
  const cellW = (w - padX * 2) / 5;      // 5 gaps between 6 strings
  const cellH = (h - padTop - padBottom) / rows;
  const left = x + padX;
  const right = left + cellW * 5;
  const top = y + padTop;
  const bottom = top + cellH * rows;

  // Left-handed play just mirrors the string axis; everything else follows.
  const stringX = [];
  for (let s = 0; s < 6; s++) stringX.push(lefty ? right - s * cellW : left + s * cellW);
  const fretY = [];
  for (let r = 0; r <= rows; r++) fretY.push(top + r * cellH);

  const markerR = cellW * 0.22;
  const markerY = top - padTop * 0.45;
  const markers = [];
  for (const s of shape.muted) markers.push({ s, kind: 'x', x: stringX[s], y: markerY, r: markerR });
  for (const s of shape.open) markers.push({ s, kind: 'o', x: stringX[s], y: markerY, r: markerR });
  markers.sort((a, b) => a.s - b.s);

  const dotR = cellW * 0.34;
  const dots = shape.dots.map((d) => ({
    s: d.s,
    fret: d.fret,
    finger: d.finger,
    inBarre: d.inBarre,
    x: stringX[d.s],
    y: top + (d.fret - shape.baseFret + 0.5) * cellH,
    r: dotR,
  }));

  let barre = null;
  if (shape.barre) {
    barre = {
      fret: shape.barre.fret,
      fromS: shape.barre.fromS,
      toS: shape.barre.toS,
      finger: shape.barre.finger,
      y: top + (shape.barre.fret - shape.baseFret + 0.5) * cellH,
      h: dotR * 1.7,
    };
  }

  return {
    x, y, w, h, lefty,
    grid: { left, top, right, bottom, cellW, cellH, rows },
    stringX,
    fretY,
    nut: { show: !!shape.showNut, y: top, thickness: Math.max(2.5, w * 0.028) },
    // A shape that does not start at the nut says where it does start instead.
    baseLabel: shape.showNut ? null
      : { text: shape.baseFret + 'fr', x: left - padX * 0.55, y: top + cellH * 0.5 },
    markers,
    dots,
    barre,
  };
}

// How much of the layout is visible at a given reveal. Pure and monotonic, so
// the diagram can only ever gain detail as a fighter closes, never lose it.
export function revealPlan(shape, reveal, opts) {
  const scaffoldAt = opts && opts.scaffoldAt != null ? opts.scaffoldAt : SCAFFOLD_AT;
  const total = shape && shape.dots ? shape.dots.length : 0;
  const r = Math.max(0, Math.min(1, Number.isFinite(reveal) ? reveal : 0));
  if (r < scaffoldAt) return { showScaffold: false, dotCount: 0, topString: -1 };
  const frac = scaffoldAt >= 1 ? 1 : (r - scaffoldAt) / (1 - scaffoldAt);
  const dotCount = Math.max(0, Math.min(total, Math.floor(frac * total + 1e-9)));
  const topString = dotCount > 0 ? shape.dots[dotCount - 1].s : -1;
  return { showScaffold: true, dotCount, topString };
}

// ── Canvas rendering ──────────────────────────────────────────────────────

// Draws the box and returns the layout it used, so callers can position
// captions relative to it.
export function drawChord(ctx, shape, box, opts) {
  const o = opts || {};
  const L = layoutChord(shape, box);
  if (!L) return null;
  const plan = revealPlan(shape, o.reveal != null ? o.reveal : 1, o);
  if (!plan.showScaffold) return L;

  const accent = o.accent || '120,255,200';
  const alpha = o.alpha != null ? o.alpha : 1;
  const dotColor = o.dotColor || '#ffe14d';
  const showFingers = o.showFingers !== false;
  const g = L.grid;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'butt';

  // Strings (vertical) and frets (horizontal).
  ctx.strokeStyle = 'rgba(200,225,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const sx of L.stringX) { ctx.moveTo(sx, g.top); ctx.lineTo(sx, g.bottom); }
  for (let r = L.nut.show ? 1 : 0; r < L.fretY.length; r++) {
    ctx.moveTo(g.left, L.fretY[r]); ctx.lineTo(g.right, L.fretY[r]);
  }
  ctx.stroke();

  // The nut, or the fret number that stands in for it.
  if (L.nut.show) {
    ctx.strokeStyle = `rgba(${accent},0.9)`;
    ctx.lineWidth = L.nut.thickness;
    ctx.beginPath();
    ctx.moveTo(g.left, L.nut.y); ctx.lineTo(g.right, L.nut.y);
    ctx.stroke();
  } else if (L.baseLabel) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(L.w * 0.11)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(200,225,255,0.8)';
    ctx.fillText(L.baseLabel.text, L.baseLabel.x, L.baseLabel.y);
  }

  // Which strings are in play — scaffolding, not the answer.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1.6;
  for (const m of L.markers) {
    if (m.kind === 'o') {
      ctx.strokeStyle = 'rgba(200,225,255,0.75)';
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(200,225,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(m.x - m.r, m.y - m.r); ctx.lineTo(m.x + m.r, m.y + m.r);
      ctx.moveTo(m.x + m.r, m.y - m.r); ctx.lineTo(m.x - m.r, m.y + m.r);
      ctx.stroke();
    }
  }

  // The barre grows in with the dots rather than popping into place: it is
  // clipped to the revealed prefix of its string span.
  if (L.barre && plan.topString >= L.barre.fromS) {
    const endS = Math.min(L.barre.toS, plan.topString);
    const x0 = L.stringX[L.barre.fromS], x1 = L.stringX[endS];
    const bx = Math.min(x0, x1), bw = Math.abs(x1 - x0);
    const r = L.barre.h / 2;
    ctx.fillStyle = dotColor;
    ctx.strokeStyle = 'rgba(2,10,20,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx - r, L.barre.y - r, bw + r * 2, r * 2, r);
    else ctx.rect(bx - r, L.barre.y - r, bw + r * 2, r * 2);
    ctx.fill(); ctx.stroke();
  }

  // Fretted dots, low-E first.
  for (let i = 0; i < plan.dotCount; i++) {
    const d = L.dots[i];
    if (d.inBarre) continue; // already covered by the bar
    ctx.fillStyle = dotColor;
    ctx.strokeStyle = 'rgba(2,10,20,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (showFingers && d.finger >= 1 && d.r >= 7) {
      ctx.fillStyle = '#0b1020';
      ctx.font = `800 ${Math.round(d.r * 1.25)}px system-ui, sans-serif`;
      ctx.fillText(String(d.finger), d.x, d.y + d.r * 0.05);
    }
  }

  ctx.restore();
  return L;
}
