// Strum Fighter — 2D cockpit HUD overlay (canvas above the WebGL canvas).
//
// Draws the canopy frame/vignette, the center targeting reticle, the locked
// enemy's chord name (big, top-center), its chord diagram (right-hand card),
// score/wave/combo readouts, the hull
// integrity bar, an input-level meter, transient hit/miss flashes, a boss
// shield bar, wave banners, bonus toasts, and the active-livery badge. Accent
// colours follow the active livery (state.skin).

export function createHud(container, deps) {
  // drawChord is injected rather than imported: a static import here would
  // resolve without game.js's ?v=BUILD cache-buster and serve a stale module.
  // Absent deps simply means no diagram, never an error.
  const drawChord = (deps && deps.drawChord) || null;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:2;';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let W = 1, H = 1, dpr = 1;
  let flashColor = null, flashAt = 0;
  // Default livery accent (teal) — overridden each frame via state.skin.
  let accent = '120,255,200';
  let lockKey = null, lockAt = 0; // for the lock-on converge animation

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, container.clientWidth);
    H = Math.max(1, container.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  function flash(kind) { flashColor = kind === 'hit' ? '0,255,170' : '255,70,90'; flashAt = performance.now(); }

  function roundedBar(x, y, w, h, frac, color) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  function update(s) {
    const now = performance.now();
    if (s.skin && s.skin.accent) accent = s.skin.accent;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;

    // ── Canopy vignette ──
    const vg = ctx.createRadialGradient(cx, cy * 0.92, Math.min(W, H) * 0.30, cx, cy, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ── Dashboard arc along the bottom (the cockpit console) ──
    const dashH = H * 0.15;
    const dgrad = ctx.createLinearGradient(0, H - dashH, 0, H);
    dgrad.addColorStop(0, 'rgba(10,16,28,0)');
    dgrad.addColorStop(0.5, 'rgba(10,16,28,0.8)');
    dgrad.addColorStop(1, 'rgba(7,11,20,0.97)');
    ctx.fillStyle = dgrad;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H - dashH * 0.5);
    ctx.quadraticCurveTo(cx, H - dashH * 1.6, W, H - dashH * 0.5);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(${accent},0.35)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H - dashH * 0.5);
    ctx.quadraticCurveTo(cx, H - dashH * 1.6, W, H - dashH * 0.5);
    ctx.stroke();

    // ── Canopy frame + glowing corner brackets ──
    ctx.strokeStyle = 'rgba(120,200,255,0.32)';
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, W - 24, H - 24);
    ctx.strokeStyle = `rgba(${accent},0.55)`;
    ctx.lineWidth = 3;
    const arm0 = 26;
    for (const [bx, by, dx, dy] of [[12, 12, 1, 1], [W - 12, 12, -1, 1], [12, H - 12, 1, -1], [W - 12, H - 12, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(bx + dx * arm0, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + dy * arm0);
      ctx.stroke();
    }

    // ── Reticle ──
    const locked = !!s.locked;
    ctx.strokeStyle = locked ? `rgba(${accent},0.95)` : 'rgba(150,190,230,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy); ctx.lineTo(cx - 14, cy);
    ctx.moveTo(cx + 14, cy); ctx.lineTo(cx + 40, cy);
    ctx.moveTo(cx, cy - 40); ctx.lineTo(cx, cy - 14);
    ctx.moveTo(cx, cy + 14); ctx.lineTo(cx, cy + 40);
    ctx.stroke();
    if (locked) {
      ctx.fillStyle = `rgba(${accent},0.9)`;
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    }

    // ── Locked chord name (big, top-center) — faded/hidden per label mode ──
    const llAlpha = s.lockedLabelAlpha == null ? 1 : s.lockedLabelAlpha;
    if (s.locked && llAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = llAlpha;
      ctx.textAlign = 'center';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(180,210,240,0.8)';
      ctx.fillText(s.lockedIsBoss ? 'PEEL' : 'STRUM', cx, 44);
      ctx.font = '900 60px Arial Black, system-ui, sans-serif';
      ctx.fillStyle = '#ffe14d';
      ctx.shadowColor = 'rgba(255,220,60,0.6)'; ctx.shadowBlur = 16;
      ctx.fillText(s.locked, cx, 96);
      ctx.shadowBlur = 0;
      ctx.restore();
    } else if (s.locked) {
      // Ear-only: no letter, but keep a small prompt so you know you're locked.
      ctx.textAlign = 'center';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillStyle = `rgba(${accent},0.7)`;
      ctx.fillText(s.lockedIsBoss ? 'PEEL BY EAR' : 'STRUM BY EAR', cx, 50);
    }

    // ── Boss shield bar (top-center, under the chord name) ──
    if (s.boss) {
      const b = s.boss;
      const bw = Math.min(440, W * 0.6), bx = cx - bw / 2, by = 120;
      ctx.textAlign = 'center';
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.fillStyle = '#ff7088';
      ctx.fillText(`⚠ BOSS — ${b.name.toUpperCase()} ⚠`, cx, by - 8);
      // Segmented shield plates — peeled left→right to match the progression
      // glyphs (a plate is down once its chord index is below the current step).
      const gap = 5, segW = (bw - gap * (b.plates - 1)) / b.plates;
      for (let i = 0; i < b.plates; i++) {
        const segX = bx + i * (segW + gap);
        const intact = i >= b.idx;
        ctx.fillStyle = intact ? '#ff5a78' : 'rgba(120,140,160,0.18)';
        if (intact) { ctx.shadowColor = 'rgba(255,90,120,0.7)'; ctx.shadowBlur = 8; }
        ctx.fillRect(segX, by, segW, 12);
        ctx.shadowBlur = 0;
      }
      ctx.strokeStyle = 'rgba(255,120,140,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, bw, 12);
    }

    // ── Locked chord diagram (right-hand target card) ──
    // Not top-center: that space holds the chord name at y=96 and, on boss
    // waves, the shield bar at y=120 — a card that jumps aside when a boss
    // warps in reads worse than one that never moves. The right column is
    // empty in every game state, and leaves room for the NEXT card below.
    if (drawChord && s.shape && s.shapeReveal > 0.001 && W >= 520 && H >= 420) {
      const bw = Math.max(84, Math.min(150, W * 0.13));
      drawChord(ctx, s.shape, { x: W - 28 - bw, y: 104, w: bw, lefty: !!s.lefty },
        { reveal: s.shapeReveal, accent, alpha: 0.92, showFingers: bw >= 100 });
    }

    // ── Targeting bracket on the locked enemy (lock-on converge animation) ──
    if (s.lockedScreen) {
      // Track lock changes to drive a brief converge-in animation.
      if (s.lockKey && s.lockKey !== lockKey) { lockKey = s.lockKey; lockAt = now; }
      const conv = Math.min(1, (now - lockAt) / 260); // 0→1 settle
      const ease = 1 - Math.pow(1 - conv, 3);
      const { x, y, r } = s.lockedScreen;
      const spread = r * (1 + (1 - ease) * 0.8);            // start wide, snap in
      const p = spread + Math.sin(now * 0.006) * 3;
      const arm = p * 0.45;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((1 - ease) * 0.5);                          // small settle spin
      ctx.strokeStyle = `rgba(${accent},${0.5 + 0.45 * ease})`;
      ctx.lineWidth = s.lockedIsBoss ? 4 : 3;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const px = sx * p, py = sy * p;
        ctx.beginPath();
        ctx.moveTo(px, py - sy * arm); ctx.lineTo(px, py); ctx.lineTo(px - sx * arm, py);
        ctx.stroke();
      }
      ctx.restore();
      if (s.locked && !s.lockedIsBoss && llAlpha > 0.02) {
        ctx.save();
        ctx.globalAlpha = llAlpha;
        ctx.textAlign = 'center';
        ctx.font = '900 24px Arial Black, system-ui, sans-serif';
        ctx.fillStyle = '#ffe14d';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6;
        ctx.fillText(s.locked, x, y - p - 8);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
      // "Now sounding" pulse — when the enemy voices its chord, ping a ring +
      // ♪ at the ship so you know exactly when to listen.
      if (s.cueAt && now - s.cueAt < 600) {
        const el = (now - s.cueAt) / 600;
        ctx.save();
        ctx.globalAlpha = (1 - el) * 0.9;
        ctx.strokeStyle = `rgba(${accent},1)`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, 18 + el * 48, 0, Math.PI * 2); ctx.stroke();
        ctx.font = '700 24px system-ui, sans-serif';
        ctx.fillStyle = `rgba(${accent},1)`;
        ctx.textAlign = 'center';
        ctx.fillText('♪', x, y - 34 - el * 12);
        ctx.restore();
      }
    }

    // ── Score / wave (top-left) ──
    ctx.textAlign = 'left';
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText(String(s.score | 0), 28, 44);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(180,210,240,0.75)';
    ctx.fillText(`WAVE ${s.wave}/${s.waveCount}`, 28, 64);

    // ── Combo (top-right) ──
    if (s.combo > 1) {
      ctx.textAlign = 'right';
      const pulse = 1 + Math.max(0, 1 - (now - (s.comboAt || 0)) / 200) * 0.4;
      ctx.save();
      ctx.translate(W - 28, 40);
      ctx.scale(pulse, pulse);
      ctx.font = '900 24px Arial Black, system-ui, sans-serif';
      ctx.fillStyle = `rgba(${accent},1)`;
      ctx.fillText(`x${s.combo}`, 0, 6);
      ctx.restore();
    }

    // ── Hull bar (bottom-center) ──
    const bw2 = Math.min(280, W * 0.5), bx2 = cx - bw2 / 2, by2 = H - 40;
    ctx.textAlign = 'left';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(180,210,240,0.75)';
    ctx.fillText('HULL', bx2, by2 - 6);
    const hullFrac = s.hull / s.hullMax;
    roundedBar(bx2, by2, bw2, 12, hullFrac, hullFrac > 0.33 ? '#54e0a0' : '#ff5566');

    // ── Input level meter (bottom-left) ──
    const lw = 120, lx = 28, ly = H - 40;
    ctx.fillStyle = 'rgba(180,210,240,0.75)';
    ctx.fillText('INPUT', lx, ly - 6);
    roundedBar(lx, ly, lw, 8, Math.min(1, (s.level || 0) * 4), '#66ccff');

    // ── Livery badge (bottom-right) ──
    if (s.skin) {
      ctx.textAlign = 'right';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillStyle = `rgba(${accent},0.9)`;
      ctx.fillText(`${s.skin.badge || ''} ${(s.skin.label || '').toUpperCase()} LIVERY`, W - 28, ly + 2);
    }

    // ── Last hit/miss verdict (fades out) ──
    if (s.verdict) {
      const el = (now - s.verdict.at) / 1100;
      if (el < 1) {
        ctx.textAlign = 'center';
        ctx.globalAlpha = 1 - el;
        ctx.font = '800 30px system-ui, sans-serif';
        ctx.fillStyle = s.verdict.kind === 'hit' ? '#7fffd4' : '#ff8095';
        ctx.fillText(s.verdict.text, cx, cy + 100 - el * 22);
        ctx.globalAlpha = 1;
      }
    }

    // ── Post-kill chord reveal (ear-training answer at the explosion) ──
    if (s.reveal) {
      const el = (now - s.reveal.at) / 1150;
      if (el < 1) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - el);
        ctx.textAlign = 'center';
        ctx.font = '900 38px Arial Black, system-ui, sans-serif';
        ctx.fillStyle = '#7fffd4';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 12;
        ctx.fillText(s.reveal.text, s.reveal.x, s.reveal.y - el * 26);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    }

    // ── Bonus toast (wave-clear / no-damage / boss-down) ──
    if (s.toast) {
      const el = (now - s.toast.at) / 1500;
      if (el < 1) {
        const a = el < 0.15 ? el / 0.15 : (1 - (el - 0.15) / 0.85);
        ctx.textAlign = 'center';
        ctx.globalAlpha = Math.max(0, a);
        ctx.font = '900 40px Arial Black, system-ui, sans-serif';
        ctx.fillStyle = '#ffe14d';
        ctx.shadowColor = 'rgba(255,220,60,0.8)'; ctx.shadowBlur = 22;
        ctx.fillText(s.toast.text, cx, cy - 120 - el * 16);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }

    // ── Wave banner (big, brief, center) ──
    if (s.banner) {
      const el = (now - s.banner.at) / 1600;
      if (el < 1) {
        const a = el < 0.2 ? el / 0.2 : (1 - (el - 0.2) / 0.8);
        ctx.textAlign = 'center';
        ctx.globalAlpha = Math.max(0, a);
        ctx.font = '900 64px Arial Black, system-ui, sans-serif';
        ctx.fillStyle = s.banner.boss ? '#ff6078' : `rgba(${accent},1)`;
        ctx.shadowColor = s.banner.boss ? 'rgba(255,70,90,0.8)' : `rgba(${accent},0.8)`;
        ctx.shadowBlur = 26;
        ctx.fillText(s.banner.text, cx, cy - 30);
        if (s.banner.sub) {
          ctx.font = '800 24px system-ui, sans-serif';
          ctx.fillStyle = '#eaf6ff';
          ctx.shadowBlur = 8;
          ctx.fillText(s.banner.sub, cx, cy + 18);
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }

    // ── Transient hit/miss flash ──
    if (flashColor) {
      const el = (now - flashAt) / 260;
      if (el < 1) {
        ctx.fillStyle = `rgba(${flashColor},${(1 - el) * 0.28})`;
        ctx.fillRect(0, 0, W, H);
      } else {
        flashColor = null;
      }
    }
  }

  function dispose() {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return { update, flash, resize, dispose };
}
