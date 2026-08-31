'use strict';
// Coverage for assets/modules/library.js.
//
// fetch, WebSocket and location are all injectable, so the host API is stood
// up here as fakes — including the failure shapes that actually happen: a
// library with nothing playable in it, a Guitar Pro import whose templates are
// all -1, a socket that dies mid-stream, and a chart that never says "ready".
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MOD = pathToFileURL(
    path.join(__dirname, '..', 'assets', 'modules', 'library.js')).href;

const LOC = { protocol: 'http:', host: '127.0.0.1:8000' };

// Minimal stand-in for the host's /api/library.
function fakeFetch(pages) {
    const calls = [];
    const impl = async (url) => {
        calls.push(url);
        const favourites = url.includes('favorites=1');
        const songs = favourites ? (pages.favourites || []) : (pages.recent || []);
        if (pages.fail) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, json: async () => ({ songs }) };
    };
    impl.calls = calls;
    return impl;
}

// Stand-in for the highway socket: replays a script of frames.
function fakeSocket(script) {
    return class {
        constructor(url) {
            this.url = url;
            this.onmessage = null; this.onerror = null; this.onclose = null;
            setTimeout(() => {
                for (const frame of script) {
                    if (frame === '__error') { if (this.onerror) this.onerror(); return; }
                    if (frame === '__close') { if (this.onclose) this.onclose(); return; }
                    if (this.onmessage) this.onmessage({ data: JSON.stringify(frame) });
                }
            }, 0);
        }
        close() {}
    };
}

const TEMPLATES = [
    { name: 'Em7', displayName: 'Em7', frets: [0, 2, 2, 0, 3, 0], fingers: [0, 1, 2, 0, 3, 0] },
    { name: '', frets: [-1, -1, -1, -1, -1, -1], fingers: [-1, -1, -1, -1, -1, -1] },
    { name: 'G', displayName: 'G', frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
];

test('library module', async (t) => {
    const L = await import(MOD);

    await t.test('only standard tuning is offered', () => {
        assert.equal(L.isStandardTuning({ tuning_offsets: '0,0,0,0,0,0' }), true);
        assert.equal(L.isStandardTuning({ tuning_offsets: '' }), true);
        assert.equal(L.isStandardTuning({}), true, 'no offsets recorded means standard');
        assert.equal(L.isStandardTuning({ tuning_offsets: '-2,0,0,0,0,0' }), false, 'drop D');
        assert.equal(L.isStandardTuning({ tuning_offsets: '-1,-1,-1,-1,-1,-1' }), false, 'Eb');
        assert.equal(L.isStandardTuning({ tuning_offsets: 'junk' }), false);
    });

    await t.test('templates we cannot name or play are rejected', () => {
        assert.equal(L.isUsableTemplate(TEMPLATES[0]), true);
        // The Guitar Pro import case: no name, nothing fretted.
        assert.equal(L.isUsableTemplate(TEMPLATES[1]), false);
        assert.equal(L.isUsableTemplate({ name: 'X', frets: [-1, -1, -1, -1, 2, -1] }), false,
            'one string is not a chord');
        assert.equal(L.isUsableTemplate({ name: '  ', frets: [0, 2, 2, 0, 0, 0] }), false);
        assert.equal(L.isUsableTemplate({ name: 'X' }), false, 'no frets at all');
        assert.equal(L.isUsableTemplate(null), false);
        // displayName wins over name when both are present.
        assert.equal(L.templateName({ name: 'Em7', displayName: 'E minor 7' }), 'E minor 7');
    });

    await t.test('the progression is time-ordered with holds collapsed', () => {
        const chart = {
            templates: TEMPLATES,
            chords: [
                { t: 4, id: 2 },            // G
                { t: 0, id: 0 },            // Em7   (out of order on the wire)
                { t: 2, id: 0 },            // Em7   (a hold, not a change)
                { t: 6, id: 1 },            // unnamed — dropped
                { t: 8, id: 2 },            // G, but after the dropped one
                { t: 9, id: 99 },           // template that does not exist
                { t: NaN, id: 0 },          // junk timestamp
            ],
        };
        const prog = L.progressionOf(chart);
        // Em7 is held across t=0..2, then G from t=4. The unnamed template at
        // t=6 is dropped, and because it is dropped it does not break the hold:
        // the G at t=8 collapses into the same G rather than becoming a
        // spurious second change. We cannot know what the unnameable chord was,
        // and inventing a repeat would put a chord in the drill that the song
        // does not have.
        assert.deepEqual(prog.map(c => c.name), ['Em7', 'G']);
        assert.deepEqual(prog.map(c => c.t), [0, 4]);
        assert.deepEqual(prog[0].frets, [0, 2, 2, 0, 3, 0]);
        assert.deepEqual(prog[0].fingers, [0, 1, 2, 0, 3, 0]);
        // Copies, so a caller cannot reach back into the chart.
        prog[0].frets[0] = 9;
        assert.equal(TEMPLATES[0].frets[0], 0);
        assert.deepEqual(L.progressionOf(null), []);
        assert.deepEqual(L.progressionOf({ templates: [], chords: null }), []);
    });

    await t.test('the chord set keeps first-appearance order', () => {
        const prog = [
            { name: 'G', frets: [3, 2, 0, 0, 0, 3], fingers: null },
            { name: 'Em7', frets: [0, 2, 2, 0, 3, 0], fingers: null },
            { name: 'G', frets: [3, 5, 5, 4, 3, 3], fingers: null },  // second voicing
        ];
        const set = L.chordSetOf(prog);
        assert.deepEqual(set.map(c => c.name), ['G', 'Em7']);
        // The voicing the player meets first is the one that sticks.
        assert.deepEqual(set[0].frets, [3, 2, 0, 0, 0, 3]);
        assert.deepEqual(L.chordSetOf([]), []);
        assert.deepEqual(L.chordSetOf(null), []);
    });

    await t.test('boss plates follow the song and cycle when it is short', () => {
        const p = (names) => names.map((n, i) => ({ t: i, name: n, frets: [0, 2, 2, 0, 0, 0], fingers: null }));
        assert.deepEqual(L.bossSliceOf(p(['Em', 'D']), 0, 6), ['Em', 'D', 'Em'],
            'a boss needs three plates');
        assert.deepEqual(L.bossSliceOf(p(['Em', 'C', 'G', 'D']), 0, 6), ['Em', 'C', 'G', 'D']);
        const long = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
        assert.deepEqual(L.bossSliceOf(p(long), 0, 6), ['A', 'B', 'C', 'D', 'E', 'F']);
        assert.deepEqual(L.bossSliceOf(p(long), 1, 6), ['G', 'H', 'A', 'B', 'C', 'D'],
            'the next boss drills the next slice');
        // Every slice is playable and the right length.
        for (let occ = 0; occ < 5; occ++) {
            const slice = L.bossSliceOf(p(long), occ, 6);
            assert.equal(slice.length, 6);
            for (const n of slice) assert.ok(long.includes(n));
        }
        assert.equal(L.bossSliceOf([], 0, 6), null);
        assert.equal(L.bossSliceOf(null, 0, 6), null);
    });

    await t.test('listSongs prefers favourites, dedupes, and filters tuning', async () => {
        const fetchImpl = fakeFetch({
            favourites: [
                { filename: 'a/fav.sloppak', title: 'Favourite', artist: 'X', tuning_offsets: '0,0,0,0,0,0' },
            ],
            recent: [
                { filename: 'a/fav.sloppak', title: 'Favourite', artist: 'X' },   // duplicate
                { filename: 'b/recent.sloppak', title: 'Recent', artist: 'Y' },
                { filename: 'c/dropd.sloppak', title: 'Drop D', tuning_offsets: '-2,0,0,0,0,0' },
                { title: 'no filename' },
            ],
        });
        const songs = await L.listSongs({ fetchImpl });
        assert.deepEqual(songs.map(s => s.title), ['Favourite', 'Recent']);
        assert.equal(songs[0].id, 'a/fav.sloppak');
        assert.ok(fetchImpl.calls[0].includes('favorites=1'));
    });

    await t.test('listSongs caps the list, because the picker is a row of buttons', async () => {
        const many = Array.from({ length: 40 }, (_, i) => ({ filename: `s${i}`, title: 'S' + i }));
        const songs = await L.listSongs({ fetchImpl: fakeFetch({ recent: many }), limit: 12 });
        assert.equal(songs.length, 12);
    });

    await t.test('a library that cannot be reached is simply empty', async () => {
        assert.deepEqual(await L.listSongs({ fetchImpl: fakeFetch({ fail: true }) }), []);
        assert.deepEqual(await L.listSongs({ fetchImpl: async () => { throw new Error('offline'); } }), []);
        assert.deepEqual(await L.listSongs({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), []);
        assert.deepEqual(await L.listSongs({ fetchImpl: null }), []);
    });

    const song = { id: 's', filename: 'Band/song.sloppak', title: 'Song', arrangement: 0 };

    await t.test('loadChart collects the frames it needs and stops at ready', async () => {
        const WebSocketImpl = fakeSocket([
            { type: 'song_info', stringCount: 6 },
            { type: 'chord_templates', data: TEMPLATES },
            { type: 'chords', data: [{ t: 0, id: 0 }] },
            { type: 'chords', data: [{ t: 4, id: 2 }] },   // batched, must accumulate
            { type: 'lyrics', data: ['ignored'] },
            { type: 'ready' },
        ]);
        const chart = await L.loadChart(song, { WebSocketImpl, location: LOC });
        assert.equal(chart.templates.length, 3);
        assert.equal(chart.chords.length, 2, 'batches should accumulate, not overwrite');
        assert.ok(chart.info);
    });

    await t.test('loadChart survives every way the socket can go wrong', async () => {
        const bad = [
            [['__error'], 'socket error'],
            [[{ type: 'chord_templates', data: TEMPLATES }, { error: 'no such song' }], 'server error frame'],
            [[{ type: 'chords', data: 'not an array' }, '__close'], 'closed with nothing'],
            [['__close'], 'closed immediately'],
        ];
        for (const [script, what] of bad) {
            const chart = await L.loadChart(song, { WebSocketImpl: fakeSocket(script), location: LOC });
            assert.equal(chart, null, what);
        }
        // Garbage on the wire is skipped rather than thrown.
        const Junk = class {
            constructor() {
                setTimeout(() => {
                    this.onmessage({ data: '{{{not json' });
                    this.onmessage({ data: JSON.stringify({ type: 'chord_templates', data: TEMPLATES }) });
                    this.onmessage({ data: JSON.stringify({ type: 'ready' }) });
                }, 0);
            }
            close() {}
        };
        const chart = await L.loadChart(song, { WebSocketImpl: Junk, location: LOC });
        assert.equal(chart.templates.length, 3);
        // A socket that never answers gives up rather than hanging the run.
        const Silent = class { constructor() {} close() {} };
        assert.equal(await L.loadChart(song, { WebSocketImpl: Silent, location: LOC, timeoutMs: 20 }), null);
        // No socket, no location, no song.
        assert.equal(await L.loadChart(song, { WebSocketImpl: null, location: LOC }), null);
        assert.equal(await L.loadChart(null, { WebSocketImpl: fakeSocket([]), location: LOC }), null);
    });

    await t.test('loadSong turns a chart into a drillable set', async () => {
        const WebSocketImpl = fakeSocket([
            { type: 'chord_templates', data: TEMPLATES },
            { type: 'chords', data: [{ t: 0, id: 0 }, { t: 4, id: 2 }, { t: 8, id: 0 }] },
            { type: 'ready' },
        ]);
        const loaded = await L.loadSong(song, { WebSocketImpl, location: LOC });
        assert.equal(loaded.title, 'Song');
        assert.deepEqual(loaded.chords.map(c => c.name), ['Em7', 'G']);
        assert.deepEqual(loaded.progression.map(c => c.name), ['Em7', 'G', 'Em7']);
    });

    await t.test('a song with nothing to practise is refused, not half-loaded', async () => {
        // One chord is not a drill — and the scheduler's no-repeat rule needs two.
        const oneChord = fakeSocket([
            { type: 'chord_templates', data: TEMPLATES },
            { type: 'chords', data: [{ t: 0, id: 0 }, { t: 4, id: 0 }] },
            { type: 'ready' },
        ]);
        assert.equal(await L.loadSong(song, { WebSocketImpl: oneChord, location: LOC }), null);
        // A pure Guitar Pro import: templates present, none of them usable.
        const gp = fakeSocket([
            { type: 'chord_templates', data: [TEMPLATES[1], TEMPLATES[1]] },
            { type: 'chords', data: [{ t: 0, id: 0 }, { t: 4, id: 1 }] },
            { type: 'ready' },
        ]);
        assert.equal(await L.loadSong(song, { WebSocketImpl: gp, location: LOC }), null);
    });
});
