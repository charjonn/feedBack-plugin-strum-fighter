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
    const { createSrs, memoryAdapter, httpAdapter, dualAdapter, gripKey, BOXES, INTERVAL, SRS_VERSION } = S;

    // Chords may be given as bare strings (key === name) or as {key, name};
    // the scheduler works in grip keys either way.
    const mk = (over) => createSrs(Object.assign({
        chords: ['A', 'B', 'C', 'D'],
        storage: memoryAdapter(),
        now: () => 1000,
        rng: lcg(7),
    }, over));
    const STORE_KEY = 'chords';

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
        await store.set(STORE_KEY, JSON.stringify({ v: SRS_VERSION + 98, c: { A: [4, 0, 9, 0, 9, 0, 100] } }));
        const srs = mk({ storage: store });
        assert.equal(await srs.hydrate(), false);
        assert.equal(srs.stateOf('A'), null);
        // So is outright junk.
        await store.set(STORE_KEY, 'not json at all');
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
        const many = Array.from({ length: 400 }, (_, i) => 'chord_with_a_long_name_' + i);
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
        const raw = await store.get(STORE_KEY);
        assert.ok(raw.length <= 131072, `payload ${raw.length} bytes`);
        const restored = mk({ chords: many, storage: store });
        await restored.hydrate();
        assert.ok(restored.size() <= 256, `kept ${restored.size()} chords`);
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
        assert.ok(!srs.chords().some(c => c.key === 'Cmaj7'));
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

    await t.test('the run report counts this run, not the whole history', async () => {
        const store = memoryAdapter();
        const first = mk({ storage: store });
        await first.hydrate();
        for (let i = 0; i < 4; i++) first.record('A', { isHit: true, score: 1 });
        first.record('B', { isHit: false });
        first.record('C', { isHit: false });
        await first.save();

        // A second run in which only 'A' is played, once, and missed.
        const second = mk({ storage: store });
        assert.equal(await second.hydrate(), true);
        assert.equal(second.stateOf('A').hits, 4, 'lifetime history is restored');
        second.record('A', { isHit: false });

        const table = second.table();
        assert.deepEqual(table.map(r => r.name), ['A'],
            'chords not played this run should not be listed');
        assert.equal(table[0].seen, 1, 'Tried counts this run only');
        assert.equal(table[0].hits, 0);
        assert.equal(table[0].misses, 1);
        // The box still reflects everything the scheduler knows, which is the
        // whole reason history is kept.
        assert.equal(table[0].box, second.stateOf('A').box);
        assert.deepEqual(second.weakest(3).map(r => r.name), ['A']);
        const mv = second.movement();
        assert.equal(mv.mastered + mv.learning + mv.slipped, 1);
        assert.equal(mv.slipped, 1, 'A fell from where it started this run');
    });

    await t.test('a grip is the same thing to learn in any song', async () => {
        // The bug this replaced: knowledge was filed per song, so Am in one
        // song was a stranger in the next.
        const AM = { key: gripKey([-1, 0, 2, 2, 1, 0]), name: 'Am' };
        const G = { key: gripKey([3, 2, 0, 0, 0, 3]), name: 'G' };
        const EM7 = { key: gripKey([0, 2, 2, 0, 3, 0]), name: 'Em7' };
        const store = memoryAdapter();

        // Song one: drill Am to mastery.
        const songOne = mk({ chords: [AM, G], storage: store });
        await songOne.hydrate();
        for (let i = 0; i < 5; i++) songOne.record(AM.key, { isHit: true, score: 1 });
        assert.equal(songOne.stateOf(AM.key).box, BOXES - 1);
        assert.equal(await songOne.save(), true);

        // Song two: a different song that also uses Am.
        const songTwo = mk({ chords: [AM, EM7], storage: store });
        assert.equal(await songTwo.hydrate(), true);
        assert.equal(songTwo.stateOf(AM.key).box, BOXES - 1, 'Am should arrive already known');
        assert.equal(songTwo.mastery(AM.key), 1);
        // And an unfamiliar chord in the same song is still unknown.
        assert.equal(songTwo.stateOf(EM7.key), null);
        // The known grip is now the lightest thing in the set.
        const w = songTwo.weights();
        assert.ok(w.find(x => x.key === AM.key).w < w.find(x => x.key === EM7.key).w);
    });

    await t.test('the grip decides identity, not the name', () => {
        const openC = { key: gripKey([-1, 3, 2, 0, 1, 0]), name: 'C' };
        const barreC = { key: gripKey([-1, 3, 5, 5, 5, 3]), name: 'C' };
        // A chart spelling it differently, but the same shape as openC.
        const spelledOut = { key: gripKey([-1, 3, 2, 0, 1, 0]), name: 'C major' };

        assert.notEqual(openC.key, barreC.key, 'two grips, two things to learn');
        assert.equal(openC.key, spelledOut.key, 'one grip, whatever it is called');

        const srs = mk({ chords: [openC, barreC] });
        for (let i = 0; i < 5; i++) srs.record(openC.key, { isHit: true, score: 1 });
        assert.equal(srs.stateOf(openC.key).box, BOXES - 1);
        assert.equal(srs.stateOf(barreC.key), null, 'the barre shape is untouched');
        // Meeting the same grip under another name finds the existing history.
        const other = mk({ chords: [spelledOut] });
        assert.equal(gripKey([-1, 3, 2, 0, 1, 0]), spelledOut.key);
        assert.ok(other);
        assert.equal(gripKey(null), '');
        assert.equal(gripKey([0, 2, 2, 0, 0, 0]), '0,2,2,0,0,0');
    });

    await t.test('a name learned once is remembered for the report', async () => {
        const AM = { key: gripKey([-1, 0, 2, 2, 1, 0]), name: 'Am' };
        const store = memoryAdapter();
        const first = mk({ chords: [AM], storage: store });
        first.record(AM.key, { isHit: true, score: 1 });
        await first.save();
        // A later run that only knows the grip still gets a readable label.
        const later = mk({ chords: [{ key: AM.key, name: '' }], storage: store });
        await later.hydrate();
        assert.equal(later.nameOf(AM.key), 'Am');
    });

    await t.test('httpAdapter round-trips through a backend', async () => {
        let stored = null;
        const calls = [];
        const fake = async (url, init) => {
            calls.push([url, init && init.method]);
            if (!init) return { ok: true, json: async () => (stored ? JSON.parse(stored) : {}) };
            stored = init.body;
            return { ok: true, json: async () => ({ ok: true }) };
        };
        const a = httpAdapter('strum_fighter', fake);
        assert.equal(await a.get('chords'), null, 'no history yet reads as empty');
        assert.equal(await a.set('chords', '{"v":2,"c":{}}'), true);
        assert.equal(await a.get('chords'), '{"v":2,"c":{}}');
        assert.ok(calls[0][0].includes('/api/plugins/strum_fighter/progress'));
        assert.equal(calls[1][1], 'PUT');
    });

    await t.test('a backend that is down never breaks the run', async () => {
        const down = httpAdapter('strum_fighter', async () => { throw new Error('ECONNREFUSED'); });
        assert.equal(await down.get('chords'), null);
        assert.equal(await down.set('chords', '{}'), false, 'a failed save must report failure');

        const errored = httpAdapter('strum_fighter', async () => ({ ok: false, status: 500, json: async () => ({}) }));
        assert.equal(await errored.get('chords'), null);
        assert.equal(await errored.set('chords', '{}'), false);

        // The scheduler carries on regardless, it just has no history.
        const srs = mk({ storage: down });
        assert.equal(await srs.hydrate(), false);
        srs.record('A', { isHit: true, score: 1 });
        assert.equal(await srs.save(), false);
        assert.equal(srs.stateOf('A').box, 1);
        assert.ok(srs.pick());
    });

    await t.test('dualAdapter keeps the data wherever it can', async () => {
        const backend = memoryAdapter(), local = memoryAdapter();
        const d = dualAdapter(backend, local);
        assert.equal(await d.set('k', 'v'), true);
        assert.equal(await backend.get('k'), 'v');
        assert.equal(await local.get('k'), 'v', 'both stores get a copy');

        // Primary wins on read, secondary covers a gap.
        await backend.set('k', 'primary');
        assert.equal(await d.get('k'), 'primary');
        await backend.remove('k');
        assert.equal(await d.get('k'), 'v');

        // Saved if either store took it...
        const dead = { async get() { return null; }, async set() { return false; }, async remove() {} };
        assert.equal(await dualAdapter(dead, local).set('k', 'v2'), true);
        // ...but a save nobody accepted must report failure, or the player is
        // told their progress is safe when it is gone.
        assert.equal(await dualAdapter(dead, dead).set('k', 'v2'), false);

        assert.equal(await dualAdapter(null, local).get('k'), 'v2');
        const mem = dualAdapter(null, null);
        await mem.set('x', '1');
        assert.equal(await mem.get('x'), '1');
    });

    await t.test('setChords swaps the active set without losing history', () => {
        const srs = mk();
        srs.record('A', { isHit: true, score: 1 });
        srs.setChords(['A', 'X']);
        assert.deepEqual(srs.chords().map(c => c.key), ['A', 'X']);
        assert.equal(srs.stateOf('A').hits, 1);
        assert.ok(['A', 'X'].includes(srs.pick()));
    });
});
