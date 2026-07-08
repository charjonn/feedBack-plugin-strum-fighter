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
