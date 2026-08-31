// Strum Fighter — enemy fighters, a boss gunship, and billboarded chord labels.
//
// Each regular enemy is a low-poly fighter flying toward the cockpit with a
// Sprite label showing the chord to strum. The boss is a larger gunship that
// flies in to a hold distance and hovers, firing — it's armoured by a chord
// PROGRESSION: strum the highlighted chord to peel a shield plate and advance;
// peel them all to expose and detonate the core.
//
// Decoupled from static cross-imports so each module loads once (cache-busted
// by game.js). game.js passes in toNotes + the world bounds from scene.js.

const HULL_COLORS = [0xff5544, 0xff8833, 0xcc55ff, 0x44ddaa];
const BOSS_COLOR = 0xff3a5c;
const BOSS_ACCENT = 0xffcaa0;

function makeLabelTexture(T, text, cache) {
  if (cache.has(text)) return cache.get(text);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  // Shrink to fit rather than run off the sprite. Even a built-in name like
  // "Cmaj7" overflows at the full size, and song mode takes chord names
  // straight from the chart, where they can be anything at all.
  let size = 84;
  const MAX_W = c.width - 24;
  do {
    ctx.font = `900 ${size}px Arial Black, Arial, sans-serif`;
    if (ctx.measureText(text).width <= MAX_W) break;
    size -= 6;
  } while (size > 24);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,200,255,0.9)';
  ctx.shadowBlur = 18;
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(2,10,20,0.95)';
  ctx.strokeText(text, 128, 70);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#eaf6ff';
  ctx.fillText(text, 128, 70);
  const tex = new T.CanvasTexture(c);
  tex.anisotropy = 4;
  cache.set(text, tex);
  return tex;
}

// Boss banner: progression name + the chord sequence with the current step
// highlighted, plus shield pips. Regenerated on each advance (not cached).
// When showLetters is false (ear-training), chord names are replaced with
// progress glyphs (done/current/pending) so the boss's health still reads
// without spoiling the chord you must identify by ear.
function makeBossLabel(T, name, chords, idx, showLetters) {
  const c = document.createElement('canvas');
  c.width = 768; c.height = 200;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Progression name.
  ctx.font = '800 34px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,210,180,0.95)';
  ctx.shadowColor = 'rgba(255,60,90,0.9)'; ctx.shadowBlur = 14;
  ctx.fillText('⚠ ' + name.toUpperCase() + ' ⚠', c.width / 2, 36);
  ctx.shadowBlur = 0;

  // Chord sequence.
  const n = chords.length;
  const slot = c.width / (n + 0.5);
  ctx.font = '900 66px Arial Black, system-ui, sans-serif';
  for (let i = 0; i < n; i++) {
    const x = slot * (i + 0.75);
    const done = i < idx, cur = i === idx;
    const glyph = showLetters ? chords[i] : (done ? '✓' : cur ? '?' : '•');
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(2,8,16,0.95)';
    ctx.strokeText(glyph, x, 112);
    if (cur) { ctx.shadowColor = 'rgba(255,225,77,0.9)'; ctx.shadowBlur = 18; ctx.fillStyle = '#ffe14d'; }
    else if (done) { ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(120,255,170,0.5)'; }
    else { ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(220,230,240,0.85)'; }
    ctx.fillText(glyph, x, 112);
    ctx.shadowBlur = 0;
  }

  // Shield pips.
  const pipW = 40, gap = 10, totalW = n * pipW + (n - 1) * gap;
  let px = (c.width - totalW) / 2;
  for (let i = 0; i < n; i++) {
    // Peel left→right in step with the chord glyphs above (plate i is down
    // once the progression has advanced past it).
    ctx.fillStyle = i >= idx ? '#ff5a78' : 'rgba(120,140,160,0.25)';
    ctx.fillRect(px, 168, pipW, 14);
    px += pipW + gap;
  }

  const tex = new T.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

export function createEnemies(T, scene, opts) {
  const { toNotes, SPAWN_Z, BREACH_Z, PLAY_HALF_W, PLAY_HALF_H } = opts;
  const enemies = [];
  const texCache = new Map();

  // Chord-label visibility: 'on' (always), 'fade' (visible far, fades as the
  // fighter nears), 'off' (never — pure ear-training). Boss chord letters show
  // only in 'on'. FADE_NEAR is the depth at which a faded label hits zero.
  let labelMode = 'on';
  const FADE_NEAR = -45;
  function labelAlpha(e) {
    if (e.boss) return 1; // boss label opacity is managed by setLocked
    if (labelMode === 'off') return 0;
    if (labelMode === 'fade') {
      const a = (FADE_NEAR - e.group.position.z) / (FADE_NEAR - SPAWN_Z);
      return Math.max(0, Math.min(1, a));
    }
    return e.isLocked ? 1 : 0.65; // 'on'
  }

  // ── Shared geometry (disposed once at teardown) ──
  const gFuse = new T.CylinderGeometry(0.35, 1.35, 5.2, 10);
  gFuse.rotateX(Math.PI / 2);              // nose along +Z (toward the player)
  const gNose = new T.ConeGeometry(0.35, 1.6, 10);
  gNose.rotateX(Math.PI / 2);
  const gCanopy = new T.SphereGeometry(0.85, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const gWing = new T.BoxGeometry(8.4, 0.22, 2.1);
  const gPod  = new T.CylinderGeometry(0.34, 0.34, 1.9, 8);
  gPod.rotateX(Math.PI / 2);
  const gFin  = new T.BoxGeometry(0.26, 1.7, 1.7);
  const gNacelle = new T.CylinderGeometry(0.5, 0.62, 2.4, 8);
  gNacelle.rotateX(Math.PI / 2);
  const gCannon = new T.CylinderGeometry(0.16, 0.16, 3.4, 6);
  gCannon.rotateX(Math.PI / 2);

  // Soft radial sprite texture for the engine glow.
  const engTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const cx = c.getContext('2d');
    const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = g; cx.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  })();

  let clock = 0;

  // Build the shared fighter silhouette into `group` using material `mat`,
  // returning the array of engine sprite materials (for flicker animation).
  function buildShip(group, mat, glowColor, scale) {
    const s = scale || 1;
    const body = new T.Mesh(gFuse, mat); body.scale.setScalar(s); group.add(body);
    const nose = new T.Mesh(gNose, mat); nose.position.z = (2.6 + 0.8) * s; nose.scale.setScalar(s); group.add(nose);
    const canopy = new T.Mesh(gCanopy, mat); canopy.position.set(0, 0.5 * s, 0.6 * s); canopy.scale.setScalar(s * 0.8); group.add(canopy);
    const wing = new T.Mesh(gWing, mat); wing.position.z = -0.3 * s; wing.scale.setScalar(s); group.add(wing);
    const fin = new T.Mesh(gFin, mat); fin.position.set(0, 0.85 * s, -1.7 * s); fin.scale.setScalar(s); group.add(fin);
    const engMats = [];
    for (const sx of [-1, 1]) {
      const pod = new T.Mesh(gPod, mat);
      pod.position.set(sx * 3.7 * s, 0, -0.2 * s); pod.scale.setScalar(s);
      group.add(pod);
      const engMat = new T.SpriteMaterial({ map: engTex, color: glowColor, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false, fog: false });
      const engine = new T.Sprite(engMat);
      engine.position.set(sx * 1.0 * s, 0, -2.7 * s);
      engine.scale.setScalar(2.2 * s);
      group.add(engine);
      engMats.push(engMat);
    }
    return engMats;
  }

  function spawn(chordName) {
    const color = HULL_COLORS[(Math.random() * HULL_COLORS.length) | 0];
    const group = new T.Group();
    const mat = new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, metalness: 0.65, roughness: 0.35 });
    const engMats = buildShip(group, mat, 0x66ddff, 1);

    // Chord label billboard above the ship.
    const tex = makeLabelTexture(T, chordName, texCache);
    const lblMat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const label = new T.Sprite(lblMat);
    label.scale.set(8, 4, 1);
    label.position.set(0, 3.9, 0);
    group.add(label);

    const bx = (Math.random() * 2 - 1) * PLAY_HALF_W;
    const by = (Math.random() * 2 - 1) * PLAY_HALF_H;
    group.position.set(bx, by, SPAWN_Z);
    scene.add(group);

    const e = {
      group, mat, label, lblMat, engMats, color,
      boss: false, isLocked: false,
      chordName, chordNotes: toNotes(chordName),
      dying: false, dead: false, fired: false,
      speedMul: 1,
      baseX: bx, baseY: by,
      weaveAx: 4 + Math.random() * 10,
      weaveAy: 3 + Math.random() * 7,
      weaveFx: 0.6 + Math.random() * 1.2,
      weaveFy: 0.5 + Math.random() * 1.1,
      phase: Math.random() * 6.28,
    };
    enemies.push(e);
    return e;
  }

  // Spawn the boss gunship armoured by `progression` ({ name, chords }).
  function spawnBoss(progression) {
    const group = new T.Group();
    const mat = new T.MeshStandardMaterial({ color: BOSS_COLOR, emissive: BOSS_COLOR, emissiveIntensity: 0.45, metalness: 0.7, roughness: 0.3 });
    const accMat = new T.MeshStandardMaterial({ color: BOSS_ACCENT, emissive: BOSS_ACCENT, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.4 });
    const engMats = buildShip(group, mat, 0xff8866, 2.6);

    // Heavy extras: twin outboard nacelles + a forward cannon spine.
    for (const sx of [-1, 1]) {
      const nac = new T.Mesh(gNacelle, accMat);
      nac.position.set(sx * 9.5, -0.6, -0.5); nac.scale.set(1.6, 1.6, 1.8);
      group.add(nac);
      const nEng = new T.SpriteMaterial({ map: engTex, color: 0xffaa66, transparent: true, opacity: 0.75, blending: T.AdditiveBlending, depthWrite: false, fog: false });
      const ns = new T.Sprite(nEng);
      ns.position.set(sx * 9.5, -0.6, -3.6); ns.scale.setScalar(5);
      group.add(ns); engMats.push(nEng);
    }
    const cannon = new T.Mesh(gCannon, accMat);
    cannon.position.set(0, -0.2, 6.5); cannon.scale.set(1.4, 1.4, 1.6);
    group.add(cannon);

    const chords = progression.chords.slice();
    const tex = makeBossLabel(T, progression.name, chords, 0, labelMode === 'on');
    const lblMat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const label = new T.Sprite(lblMat);
    label.scale.set(24, 6.25, 1);
    label.position.set(0, 9, 0);
    group.add(label);

    group.position.set(0, 4, SPAWN_Z);
    scene.add(group);

    const e = {
      group, mat, accMat, label, lblMat, engMats, labelTex: tex,
      color: BOSS_COLOR,
      boss: true,
      progName: progression.name,
      prog: chords, progIdx: 0, plates: chords.length,
      chordName: chords[0], chordNotes: toNotes(chords[0]),
      dying: false, dead: false, fired: false,
      atHold: false, holdZ: -64, fireAcc: 0,
      speedMul: 1, baseX: 0, baseY: 4,
      weaveAx: 14, weaveAy: 5, weaveFx: 0.5, weaveFy: 0.62, phase: 0,
      hitFlash: 0,
    };
    enemies.push(e);
    return e;
  }

  // Land a strum on the boss's current shield plate: advance the progression,
  // returns { destroyed, pos, color, plateIdx }. Caller pre-checks the chord.
  function hitBoss(e) {
    if (!e || !e.boss || e.dying || e.dead) return null;
    const pos = e.group.position.clone();
    e.progIdx++;
    e.hitFlash = 1;
    if (e.progIdx >= e.plates) {
      e.dying = true;
      const idx = enemies.indexOf(e);
      _remove(e, idx);
      return { destroyed: true, pos, color: BOSS_COLOR, plateIdx: e.plates };
    }
    // Advance the live target chord + redraw the banner.
    e.chordName = e.prog[e.progIdx];
    e.chordNotes = toNotes(e.chordName);
    const old = e.labelTex;
    e.labelTex = makeBossLabel(T, e.progName, e.prog, e.progIdx, labelMode === 'on');
    e.lblMat.map = e.labelTex;
    e.lblMat.needsUpdate = true;
    if (old) old.dispose();
    return { destroyed: false, pos, color: BOSS_COLOR, plateIdx: e.progIdx };
  }

  // Advance all enemies; returns the list that breached the cockpit this tick
  // (already removed from the scene/list). Boss never breaches — it holds.
  function update(dt, speed) {
    clock += dt;
    const breached = [];
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dead) { enemies.splice(i, 1); continue; }

      if (e.boss) { _updateBoss(e, dt); continue; }

      e.group.position.z += speed * dt * e.speedMul;
      const nx = e.baseX + e.weaveAx * Math.sin(clock * e.weaveFx + e.phase);
      const ny = e.baseY + e.weaveAy * Math.sin(clock * e.weaveFy + e.phase * 1.3);
      const dx = nx - e.group.position.x;
      const dy = ny - e.group.position.y;
      e.group.position.x = nx;
      e.group.position.y = ny;
      e.group.rotation.z = Math.max(-0.7, Math.min(0.7, -dx * 9));
      e.group.rotation.x = Math.max(-0.35, Math.min(0.35, -dy * 6));
      for (const m of e.engMats) m.opacity = 0.55 + 0.3 * Math.sin(clock * 9 + e.phase);
      e.lblMat.opacity = labelAlpha(e); // chord-label visibility per mode/distance
      if (e.group.position.z > BREACH_Z) { breached.push(e); _remove(e, i); }
    }
    return breached;
  }

  function _updateBoss(e, dt) {
    // Approach to hold distance, then hover + weave + slow roll.
    if (!e.atHold) {
      e.group.position.z += e.speedMul * dt * (e.bossSpeed || 12);
      if (e.group.position.z >= e.holdZ) { e.group.position.z = e.holdZ; e.atHold = true; }
    }
    const nx = e.baseX + e.weaveAx * Math.sin(clock * e.weaveFx);
    const ny = e.baseY + e.weaveAy * Math.sin(clock * e.weaveFy);
    const dx = nx - e.group.position.x;
    e.group.position.x = nx;
    e.group.position.y = ny;
    e.group.rotation.z = Math.max(-0.4, Math.min(0.4, -dx * 4)) + Math.sin(clock * 0.3) * 0.04;
    e.group.rotation.y = Math.sin(clock * 0.4) * 0.12;
    for (const m of e.engMats) m.opacity = 0.6 + 0.3 * Math.sin(clock * 7);
    if (e.hitFlash > 0) {
      e.hitFlash = Math.max(0, e.hitFlash - dt * 3);
      const f = e.hitFlash;
      e.mat.emissiveIntensity = 0.45 + f * 1.6;
      if (e.accMat) e.accMat.emissiveIntensity = 0.5 + f * 1.6;
    }
  }

  // Closest live enemy still in front of the player (the locked target).
  // A boss outranks regular fighters so you always engage it once it's in.
  function nearest() {
    let best = null, bestIsBoss = false;
    for (const e of enemies) {
      if (e.dying || e.dead) continue;
      if (e.group.position.z > BREACH_Z - 0.5) continue;
      if (e.boss && !e.atHold) continue; // not lockable until it arrives
      const isBoss = !!e.boss;
      if (!best) { best = e; bestIsBoss = isBoss; continue; }
      if (isBoss && !bestIsBoss) { best = e; bestIsBoss = true; continue; }
      if (isBoss === bestIsBoss && e.group.position.z > best.group.position.z) best = e;
    }
    return best;
  }

  // Mark a regular hit: returns world position + color for the explosion FX.
  function kill(e) {
    if (!e || e.dying || e.dead) return null;
    e.dying = true;
    const pos = e.group.position.clone();
    const idx = enemies.indexOf(e);
    _remove(e, idx);
    return { pos, color: e.color };
  }

  function _remove(e, idx) {
    e.dead = true;
    scene.remove(e.group);
    e.mat.dispose();
    if (e.accMat) e.accMat.dispose();
    e.lblMat.dispose();
    if (e.labelTex) e.labelTex.dispose();
    for (const m of e.engMats) m.dispose();
    if (idx >= 0) enemies.splice(idx, 1);
  }

  // Highlight the locked enemy + dim the rest. Label OPACITY for regular
  // fighters is owned by update() (per label mode / distance); here we only set
  // the locked flag, hull glow, and the boss label opacity.
  function setLocked(locked) {
    for (const e of enemies) {
      if (e.dying || e.dead) continue;
      e.isLocked = (e === locked);
      if (e.boss) { e.lblMat.opacity = e.isLocked ? 1 : 0.95; continue; }
      if (e.isLocked) { e.lblMat.color.setHex(0xffe14d); e.mat.emissiveIntensity = 0.7; }
      else { e.lblMat.color.setHex(0xffffff); e.mat.emissiveIntensity = 0.3; }
      // Apply the lock change to opacity now (update() runs before setLocked in
      // the loop, so otherwise the new lock state lags a frame).
      e.lblMat.opacity = labelAlpha(e);
    }
  }

  // After firing at the player, the fighter breaks off — boosts past and veers
  // to a corner instead of ramming. Boss never peels.
  function peel(e) {
    if (!e || e.fired || e.boss) return;
    e.fired = true;
    e.speedMul = 2.4;
    e.baseX = (e.baseX >= 0 ? 1 : -1) * PLAY_HALF_W * 1.5;
    e.baseY = (e.baseY >= 0 ? 1 : -1) * PLAY_HALF_H * 1.3;
    e.weaveAx = 0; e.weaveAy = 0;
  }

  function aliveCount() {
    let n = 0;
    for (const e of enemies) if (!e.dying && !e.dead) n++;
    return n;
  }

  function bossInPlay() {
    for (const e of enemies) if (e.boss && !e.dying && !e.dead) return e;
    return null;
  }

  function reset() {
    for (let i = enemies.length - 1; i >= 0; i--) _remove(enemies[i], i);
    enemies.length = 0;
  }

  function dispose() {
    reset();
    gFuse.dispose(); gNose.dispose(); gCanopy.dispose(); gWing.dispose();
    gPod.dispose(); gFin.dispose(); gNacelle.dispose(); gCannon.dispose();
    engTex.dispose();
    for (const tex of texCache.values()) tex.dispose();
    texCache.clear();
  }

  return {
    spawn, spawnBoss, hitBoss, update, nearest, kill, peel, setLocked,
    aliveCount, bossInPlay, list: () => enemies, reset, dispose,
    setLabelMode(m) { labelMode = (m === 'fade' || m === 'off') ? m : 'on'; },
  };
}
