'use strict';
// Coverage for assets/modules/chords.js (ESM, loaded via dynamic import).
// Runs under the org reusable CI as `node tests/chords.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MOD = pathToFileURL(
    path.join(__dirname, '..', 'assets', 'modules', 'chords.js')).href;

test('chords module', async (t) => {
    const { CHORDS, toNotes, pool, bossProgression, tierParams, waveCount, bossWaves } =
        await import(MOD);

    await t.test('every chord is a 6-string fret array with sane frets', () => {
        for (const [name, frets] of Object.entries(CHORDS)) {
            assert.equal(frets.length, 6, `${name}: string count`);
            for (const f of frets) {
                assert.ok(Number.isInteger(f) && f >= -1 && f <= 12, `${name}: fret ${f}`);
            }
            // A chord must have at least two played strings.
            assert.ok(frets.filter(f => f >= 0).length >= 2, `${name}: too few played strings`);
        }
    });

    await t.test('toNotes drops muted strings and keeps low-E-first indexing', () => {
        assert.deepEqual(toNotes('D'), [{ s: 2, f: 0 }, { s: 3, f: 2 }, { s: 4, f: 3 }, { s: 5, f: 2 }]);
        assert.deepEqual(toNotes('E'), [
            { s: 0, f: 0 }, { s: 1, f: 2 }, { s: 2, f: 2 },
            { s: 3, f: 1 }, { s: 4, f: 0 }, { s: 5, f: 0 },
        ]);
        assert.deepEqual(toNotes('nope'), []);
    });

    await t.test('pool grows with difficulty and only contains known chords', () => {
        const easy = pool('easy');
        const medium = pool('medium');
        const hard = pool('hard');
        assert.ok(easy.length < medium.length && medium.length < hard.length);
        for (const name of hard) assert.ok(CHORDS[name], `unknown chord ${name}`);
        // Lower pools are strict subsets of higher ones.
        for (const c of easy) assert.ok(medium.includes(c));
        for (const c of medium) assert.ok(hard.includes(c));
        // pool() hands out a copy, not the module-internal array.
        easy.push('XX');
        assert.ok(!pool('easy').includes('XX'));
    });

    await t.test('boss progressions only use chords from their difficulty pool', async () => {
        for (const difficulty of ['easy', 'medium', 'hard']) {
            const allowed = pool(difficulty);
            for (const r of [0, 0.4, 0.9]) {
                const prog = bossProgression(difficulty, r);
                assert.ok(prog.name && prog.chords.length >= 3);
                for (const c of prog.chords) {
                    assert.ok(allowed.includes(c), `${difficulty}/${prog.name}: ${c} outside pool`);
                }
            }
        }
    });

    await t.test('bossProgression normalizes out-of-range rng', () => {
        const list = ['easy', 'medium', 'hard'];
        for (const d of list) {
            assert.ok(bossProgression(d, -5).name);        // clamped low
            assert.ok(bossProgression(d, 5).name);         // clamped high
            assert.ok(bossProgression(d, NaN).name);       // non-finite → random
            assert.equal(bossProgression(d, 0.999999), bossProgression(d, 5)); // both clamp to last
        }
        // Unknown difficulty falls back to medium's list.
        assert.equal(bossProgression('nope', 0).name, bossProgression('medium', 0).name);
    });

    await t.test('tierParams tightens detection and pacing with difficulty', () => {
        const e = tierParams('easy'), m = tierParams('medium'), h = tierParams('hard');
        assert.ok(e.minHitRatio < m.minHitRatio && m.minHitRatio < h.minHitRatio);
        assert.ok(e.pitchCheckCents > m.pitchCheckCents && m.pitchCheckCents > h.pitchCheckCents);
        assert.ok(e.enemySpeed < m.enemySpeed && m.enemySpeed < h.enemySpeed);
        assert.ok(e.spawnEveryMs > m.spawnEveryMs && m.spawnEveryMs > h.spawnEveryMs);
        assert.ok(e.bossShots > h.bossShots); // hard boss fires more often
        // Unknown difficulty falls back to medium.
        assert.deepEqual(tierParams('nope'), m);
    });

    await t.test('waveCount maps length modifier', () => {
        assert.equal(waveCount('short'), 3);
        assert.equal(waveCount('normal'), 6);
        assert.equal(waveCount('long'), 10);
        assert.equal(waveCount(undefined), 6);
    });

    await t.test('bossWaves always includes the final wave, spaced by bossEvery', () => {
        assert.deepEqual([...bossWaves(6, 3)].sort((a, b) => a - b), [3, 6]);
        assert.deepEqual([...bossWaves(10, 3)].sort((a, b) => a - b), [3, 6, 9, 10]);
        assert.deepEqual([...bossWaves(3, 3)].sort((a, b) => a - b), [3]);
        // Non-positive interval falls back to 3 rather than looping forever.
        assert.deepEqual([...bossWaves(6, 0)].sort((a, b) => a - b), [3, 6]);
        assert.deepEqual([...bossWaves(6, -1)].sort((a, b) => a - b), [3, 6]);
    });
});

test('chord shapes', async (t) => {
    const { CHORDS, FINGERS, shapeOf, shapeFromFrets, notesFromFrets, toNotes } =
        await import(MOD);

    await t.test('FINGERS covers every chord and never contradicts its frets', () => {
        assert.deepEqual(Object.keys(FINGERS).sort(), Object.keys(CHORDS).sort());
        for (const [name, fingers] of Object.entries(FINGERS)) {
            const frets = CHORDS[name];
            assert.equal(fingers.length, 6, `${name}: finger count`);
            for (let s = 0; s < 6; s++) {
                const fg = fingers[s], f = frets[s];
                assert.ok(Number.isInteger(fg) && fg >= -1 && fg <= 4, `${name}[${s}]: finger ${fg}`);
                // A muted string has no finger; an open string has no finger;
                // a fretted string must name one.
                assert.equal(fg === -1, f === -1, `${name}[${s}]: muted mismatch`);
                assert.equal(fg === 0, f === 0, `${name}[${s}]: open mismatch`);
                if (f > 0) assert.ok(fg >= 1, `${name}[${s}]: fretted string needs a finger`);
            }
        }
    });

    await t.test('shapeOf derives the fret window rather than authoring it', () => {
        // Every built-in chord fits against the nut.
        for (const name of Object.keys(CHORDS)) {
            const s = shapeOf(name);
            assert.ok(s, `${name}: no shape`);
            assert.equal(s.baseFret, 1, `${name}: baseFret`);
            assert.ok(s.showNut, `${name}: showNut`);
            assert.ok(s.fretWindow >= 4 && s.fretWindow <= 5, `${name}: window ${s.fretWindow}`);
            assert.equal(s.dots.length, CHORDS[name].filter(f => f > 0).length, `${name}: dot count`);
            // Dots ascend by string so the reveal order is low-E first.
            for (let i = 1; i < s.dots.length; i++) {
                assert.ok(s.dots[i].s > s.dots[i - 1].s, `${name}: dots out of order`);
            }
        }
        assert.equal(shapeOf('nope'), null);
    });

    await t.test('a shape further up the neck shifts the window instead', () => {
        const cm = shapeFromFrets('Cm', [-1, 3, 5, 5, 4, 3], [-1, 1, 3, 4, 2, 1]);
        assert.equal(cm.baseFret, 3);
        assert.equal(cm.showNut, false);
        assert.equal(cm.fretWindow, 4);
        assert.equal(cm.span, 3);
    });

    await t.test('barres are derived from finger 1 landing twice at one fret', () => {
        assert.deepEqual(shapeOf('F').barre, { fret: 1, fromS: 0, toS: 5, finger: 1 });
        assert.deepEqual(shapeOf('Bm').barre, { fret: 2, fromS: 1, toS: 5, finger: 1 });
        // A two-string mini-barre still counts.
        assert.deepEqual(shapeOf('Dm7').barre, { fret: 1, fromS: 4, toS: 5, finger: 1 });
        assert.equal(shapeOf('C').barre, null);
        assert.equal(shapeOf('D').barre, null);
        // Dots covered by the bar are marked so the renderer can skip them.
        const f = shapeOf('F');
        for (const d of f.dots) assert.equal(d.inBarre, d.finger === 1 && d.fret === 1);
    });

    await t.test('shapeFromFrets tolerates the junk a song template can carry', () => {
        // Guitar Pro imports often emit no fingers at all.
        const s = shapeFromFrets('X', [-1, 0, 2, 2, 2, 0], null);
        assert.ok(s && s.dots.length === 3);
        for (const d of s.dots) assert.equal(d.finger, 0);
        assert.equal(s.barre, null);
        // A finger that contradicts its fret is dropped, not trusted.
        const t2 = shapeFromFrets('Y', [-1, -1, 0, 2, 3, 2], [3, 3, 3, 1, 3, 2]);
        assert.deepEqual(t2.fingers, [-1, -1, 0, 1, 3, 2]);
        assert.equal(shapeFromFrets('Z', [], []), null);
        assert.equal(shapeFromFrets('Z', null, null), null);
    });

    await t.test('shapeOf hands out copies, not the module-internal arrays', () => {
        const s = shapeOf('C');
        s.frets[0] = 99;
        s.fingers[0] = 99;
        assert.equal(CHORDS.C[0], -1);
        assert.equal(FINGERS.C[0], -1);
    });

    await t.test('notesFromFrets matches toNotes but takes a raw array', () => {
        assert.deepEqual(notesFromFrets(CHORDS.D), toNotes('D'));
        assert.deepEqual(notesFromFrets(CHORDS.F), toNotes('F'));
        assert.deepEqual(notesFromFrets([]), []);
        assert.deepEqual(notesFromFrets(null), []);
        // Non-integers are skipped rather than reaching the scorer as NaN.
        assert.deepEqual(notesFromFrets([0, null, 2, undefined, 'x', 1]),
            [{ s: 0, f: 0 }, { s: 2, f: 2 }, { s: 5, f: 1 }]);
    });
});
