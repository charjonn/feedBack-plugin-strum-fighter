'use strict';
// Coverage for assets/modules/srs.js.
//
// Storage and both clocks are injected, so everything here runs deterministically
// in Node with no DOM and no wall-clock dependence.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MOD = pathToFileURL(
    path.join(__dirname, '..', 'assets', 'modules', 'srs.js')).href;

// A tiny deterministic PRNG so "500 picks" means the same 500 every run.
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('srs module', async (t) => {
    const S = await import(MOD);
    const { createSrs, memoryAdapter, BOXES, INTERVAL, SRS_VERSION } = S;

    const mk = (over) => createSrs(Object.assign({
        chords: ['A', 'B', 'C', 'D'],
        key: 'pool:test',
        storage: memoryAdapter(),
        now: () => 1000,
        rng: lcg(7),
    }, over));

    await t.test('never serves the same chord twice in a row', () => {
        const srs = mk({ rng: lcg(42) });
        let prev = null;
        for (let i = 0; i < 500; i++) {
            const c = srs.pick();
            assert.notEqual(c, prev, `repeat at pick ${i}`);
            prev = c;
        }
    });

    await t.test('a one-chord set repeats rather than deadlocking', () => {
        const srs = mk({ chords: ['A'] });
        assert.equal(srs.pick(), 'A');
        assert.equal(srs.pick(), 'A');
        assert.equal(mk({ chords: [] }).pick(), null);
    });

    await t.test('the weighted walk spans its candidates', () => {
        const srs = mk();
        // First pick sees all four; rnd 0 lands on the first, ~1 on the last.
        assert.equal(srs.pick(0), 'A');
        // 'A' is now excluded, so the remaining three are B, C, D.
        assert.equal(srs.pick(0.999999), 'D');
    });

    await t.test('unseen chords are introduced early', () => {
        const srs = mk({ chords: ['A', 'B', 'C', 'D', 'E'], rng: lcg(3) });
        const seen = new Set();
        for (let i = 0; i < 10; i++) seen.add(srs.pick());
        assert.equal(seen.size, 5, `only saw ${[...seen].join(',')}`);
    });

    await t.test('clean hits promote to mastery and sink the weight', () => {
        const srs = mk();
        const before = srs.weights().find(w => w.name === 'A').w;
        for (let i = 0; i < 5; i++) srs.record('A', { isHit: true, score: 1 });
        const st = srs.stateOf('A');
        assert.equal(st.box, BOXES - 1);
        assert.equal(st.hits, 5);
        assert.equal(st.streak, 5);
        assert.equal(srs.mastery('A'), 1);
        const after = srs.weights().find(w => w.name === 'A').w;
        assert.ok(after < before, `weight did not fall: ${before} -> ${after}`);
        // And it is now the lightest of the set.
        const min = Math.min(...srs.weights().map(w => w.w));
        assert.equal(after, min);
    });

    await t.test('a miss costs more than a hit earns', () => {
        const srs = mk();
        for (let i = 0; i < 5; i++) srs.record('A', { isHit: true, score: 1 });
        const before = srs.weights().find(w => w.name === 'A').w;
        srs.record('A', { isHit: false, score: 0 });
        const st = srs.stateOf('A');
        assert.equal(st.box, BOXES - 1 - 2, 'a miss drops two boxes');
        assert.equal(st.lapses, 1);
        assert.equal(st.streak, 0);
        assert.equal(st.misses, 1);
        const after = srs.weights().find(w => w.name === 'A').w;
        assert.ok(after > before, `weight did not rise: ${before} -> ${after}`);
    });

    await t.test('a scrappy hit has to be repeated before it counts', () => {
        const srs = mk();
        srs.record('A', { isHit: true, score: 0.4 });
        assert.equal(srs.stateOf('A').box, 0, 'a scrape should not promote alone');
        srs.record('A', { isHit: true, score: 0.4 });
        assert.equal(srs.stateOf('A').box, 1, 'two in a row should');
        // A clean hit promotes immediately.
        const srs2 = mk();
        srs2.record('B', { isHit: true, score: 0.95 });
        assert.equal(srs2.stateOf('B').box, 1);
    });

    await t.test('isLeech marks only the chords that keep slipping away', () => {
        const srs = mk();
        assert.equal(srs.isLeech('A'), false);
        srs.record('A', { isHit: false });                       // box 0, no lapse yet
        assert.equal(srs.isLeech('A'), false);
        for (let i = 0; i < 2; i++) {
            srs.record('A', { isHit: true, score: 1 });
            srs.record('A', { isHit: true, score: 1 });
            srs.record('A', { isHit: false });                   // up then down
        }
        assert.equal(srs.stateOf('A').lapses, 2);
        assert.equal(srs.stateOf('A').box, 0);
        assert.equal(srs.isLeech('A'), true);
        assert.equal(srs.isLeech('nope'), false);
    });

    await t.test('a chord left alone grows heavier until it comes back', () => {
        const srs = mk();
        srs.record('A', { isHit: true, score: 1 });
        const atDue = srs.weights().find(w => w.name === 'A').w;
        for (let i = 0; i < 30; i++) srs.pick();
        const overdue = srs.weights().find(w => w.name === 'A').w;
        assert.ok(overdue > atDue, `overdue weight did not grow: ${atDue} -> ${overdue}`);
    });

    await t.test('history survives a round trip through storage', async () => {
        const store = memoryAdapter();
        const a = mk({ storage: store });
        await a.hydrate();
        a.record('A', { isHit: true, score: 0.9 });
        a.record('A', { isHit: true, score: 0.9 });
        a.record('B', { isHit: false });
        assert.equal(await a.save(), true);

        const b = mk({ storage: store });
        assert.equal(await b.hydrate(), true);
        assert.equal(b.stateOf('A').box, a.stateOf('A').box);
        assert.equal(b.stateOf('A').hits, 2);
        assert.equal(b.stateOf('B').misses, 1);
        assert.ok(Math.abs(b.mastery('A') - a.mastery('A')) < 0.02);
        // dueTick is derived on load rather than stored.
        assert.equal(b.stateOf('A').dueTick,
            b.stateOf('A').lastTick + INTERVAL[b.stateOf('A').box]);
    });

    await t.test('a payload from another schema is discarded, not guessed at', async () => {
        const store = memoryAdapter();
        await store.set('pool:test', JSON.stringify({ v: SRS_VERSION + 98, c: { A: [4, 0, 9, 0, 9, 0, 100] } }));
        const srs = mk({ storage: store });
        assert.equal(await srs.hydrate(), false);
        assert.equal(srs.stateOf('A'), null);
        // So is outright junk.
        await store.set('pool:test', 'not json at all');
        const srs2 = mk({ storage: store });
        assert.equal(await srs2.hydrate(), false);
    });

    await t.test('boxes decay while you are away', async () => {
        const store = memoryAdapter();
        const a = mk({ storage: store, now: () => 0 });
        for (let i = 0; i < 5; i++) a.record('A', { isHit: true, score: 1 });
        assert.equal(a.stateOf('A').box, 4);
        await a.save();

        const day = 864e5;
        const fresh = mk({ storage: store, now: () => 2 * day });
        await fresh.hydrate();
        assert.equal(fresh.stateOf('A').box, 4, 'two days should cost nothing');

        const stale = mk({ storage: store, now: () => 35 * day });
        await stale.hydrate();
        assert.equal(stale.stateOf('A').box, 1, '35 idle days should cost three boxes');

        const ancient = mk({ storage: store, now: () => 500 * day });
        await ancient.hydrate();
        assert.equal(ancient.stateOf('A').box, 0, 'decay floors at box 0');
    });

    await t.test('the stored payload stays small', async () => {
        const store = memoryAdapter();
        const many = Array.from({ length: 200 }, (_, i) => 'chord_with_a_long_name_' + i);
        const srs = mk({ chords: many, storage: store });
        // Give the set a real spread of boxes, so eviction order is observable:
        // every 5th chord is drilled to mastery, the rest are missed.
        many.forEach((c, i) => {
            if (i % 5 === 0) for (let k = 0; k < 5; k++) srs.record(c, { isHit: true, score: 1 });
            else srs.record(c, { isHit: false });
        });
        const mastered = many.filter((_, i) => i % 5 === 0);
        assert.equal(srs.stateOf(mastered[0]).box, 4, 'test setup: expected mastery');
        await srs.save();
        const raw = await store.get('pool:test');
        assert.ok(raw.length <= 16384, `payload ${raw.length} bytes`);
        const restored = mk({ chords: many, storage: store });
        await restored.hydrate();
        assert.ok(restored.size() <= 96, `kept ${restored.size()} chords`);
        // What survives is the material still worth practising. The chords the
        // player has already nailed are the first to go — losing them costs
        // nothing, while losing a chord they keep missing costs the schedule.
        const keptMastered = mastered.filter(c => restored.stateOf(c)).length;
        const keptWeak = many.filter((_, i) => i % 5 !== 0).filter(c => restored.stateOf(c)).length;
        assert.equal(keptMastered, 0, 'mastered chords should be evicted first');
        assert.ok(keptWeak > 0, 'weak chords should be the ones kept');
    });

    await t.test('a storage layer that throws never reaches the game', async () => {
        const bad = {
            async get() { throw new Error('nope'); },
            async set() { throw new Error('nope'); },
            async remove() { throw new Error('nope'); },
        };
        const srs = mk({ storage: bad });
        assert.equal(await srs.hydrate(), false);
        srs.record('A', { isHit: true, score: 1 });
        assert.equal(await srs.save(), false);
        assert.equal(srs.stateOf('A').box, 1, 'the run carries on regardless');
        // No storage at all is equally survivable.
        const none = mk({ storage: null });
        assert.equal(await none.hydrate(), false);
        assert.equal(await none.save(), false);
        assert.ok(none.pick());
    });

    await t.test('recording a chord outside the active set is harmless', () => {
        // Boss plates can carry chords the fighter pool never spawns.
        const srs = mk();
        srs.record('Cmaj7', { isHit: true, score: 1 });
        assert.equal(srs.stateOf('Cmaj7').hits, 1);
        // It does not leak into selection or the report.
        assert.ok(!srs.chords().includes('Cmaj7'));
        assert.ok(!srs.table().some(r => r.name === 'Cmaj7'));
        assert.equal(srs.record(null, { isHit: true }), null);
    });

    await t.test('the report ranks the material you are worst at first', () => {
        const srs = mk();
        for (let i = 0; i < 4; i++) srs.record('A', { isHit: true, score: 1 });
        srs.record('B', { isHit: false });
        srs.record('B', { isHit: false });
        srs.record('C', { isHit: true, score: 0.7 });
        const weak = srs.weakest(2);
        assert.equal(weak[0].name, 'B');
        assert.ok(weak.length === 2);
        const table = srs.table();
        assert.equal(table[0].name, 'B');
        assert.ok(table.every(r => r.seen > 0), 'unplayed chords should not be listed');
        const mv = srs.movement();
        assert.equal(mv.mastered, 1);
        assert.equal(mv.mastered + mv.learning + mv.slipped, 3);
    });

    await t.test('setChords swaps the active set without losing history', () => {
        const srs = mk();
        srs.record('A', { isHit: true, score: 1 });
        srs.setChords(['A', 'X']);
        assert.deepEqual(srs.chords(), ['A', 'X']);
        assert.equal(srs.stateOf('A').hits, 1);
        assert.ok(['A', 'X'].includes(srs.pick()));
    });
});
