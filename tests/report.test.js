'use strict';
// Coverage for assets/modules/report.js.
//
// Timing is fed explicit timestamps rather than a clock, so every case here is
// deterministic and the "you walked away" threshold can be tested exactly.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MOD = pathToFileURL(
    path.join(__dirname, '..', 'assets', 'modules', 'report.js')).href;

test('report module', async (t) => {
    const { createTimingLog, buildSummary, fmtMs, median, esc } = await import(MOD);

    await t.test('median takes the middle, not the mean', () => {
        assert.equal(median([5]), 5);
        assert.equal(median([1, 2, 3]), 2);
        assert.equal(median([1, 2, 3, 4]), 2.5);
        // The point of a median here: one lapse must not move the number much.
        assert.equal(median([1000, 1100, 1200, 60000]), 1150);
        assert.ok(Number.isNaN(median([])));
        assert.ok(Number.isNaN(median(null)));
    });

    await t.test('fmtMs reads as seconds', () => {
        assert.equal(fmtMs(2430), '2.4s');
        assert.equal(fmtMs(600), '0.6s');
        assert.equal(fmtMs(NaN), '—');
        assert.equal(fmtMs(undefined), '—');
    });

    await t.test('a clean first-attempt hit is timed', () => {
        const log = createTimingLog({ minSamples: 1 });
        log.lock('Am', 0);
        log.attempt('Am', 800, true);
        const chords = log.chordStats();
        assert.equal(chords.length, 1);
        assert.equal(chords[0].name, 'Am');
        assert.equal(chords[0].medMs, 800);
        assert.equal(chords[0].n, 1);
        // Nothing to change FROM yet, so no transition.
        assert.deepEqual(log.changeStats(), []);
    });

    await t.test('a hit that took two attempts is not a clean change', () => {
        const log = createTimingLog({ minSamples: 1 });
        log.lock('Am', 0);
        log.attempt('Am', 500, true);        // clean, establishes "from"
        log.lock('F', 1000);
        log.attempt('F', 1400, false);       // flailed
        log.attempt('F', 2200, true);        // landed, but not first try
        assert.deepEqual(log.changeStats(), [], 'a scrappy landing should not be timed');
        assert.ok(!log.chordStats().some(c => c.name === 'F'));
        // It still moves "from" along, so the NEXT change is measured correctly.
        log.lock('C', 3000);
        log.attempt('C', 3600, true);
        assert.deepEqual(log.changeStats().map(c => `${c.from}>${c.to}`), ['F>C']);
    });

    await t.test('walking away is discarded rather than averaged in', () => {
        const log = createTimingLog({ minSamples: 1, maxMs: 6000 });
        log.lock('Am', 0);
        log.attempt('Am', 500, true);
        log.lock('F', 1000);
        log.attempt('F', 1000 + 6001, true); // just past the threshold
        assert.ok(!log.chordStats().some(c => c.name === 'F'));
        // Exactly at the threshold still counts.
        log.lock('G', 20000);
        log.attempt('G', 26000, true);
        assert.ok(log.chordStats().some(c => c.name === 'G'));
    });

    await t.test('`from` follows the last HIT, not the last lock', () => {
        const log = createTimingLog({ minSamples: 1 });
        log.lock('Am', 0);
        log.attempt('Am', 400, true);
        // The reticle wanders onto a target that is never played, then back.
        log.lock('C', 1000);
        log.lock('F', 2000);
        log.attempt('F', 2500, true);
        const changes = log.changeStats();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].from, 'Am', 'C was locked but never played');
        assert.equal(changes[0].to, 'F');
    });

    await t.test('a transition needs repeating before it counts as a habit', () => {
        const log = createTimingLog({ minSamples: 3 });
        for (let i = 0; i < 2; i++) {
            log.lock('Am', i * 10000);
            log.attempt('Am', i * 10000 + 300, true);
            log.lock('F', i * 10000 + 1000);
            log.attempt('F', i * 10000 + 3000, true);
        }
        assert.deepEqual(log.changeStats(), [], 'two samples is noise');
        log.lock('Am', 50000);
        log.attempt('Am', 50300, true);
        log.lock('F', 51000);
        log.attempt('F', 53000, true);
        assert.equal(log.changeStats().length, 1);
        assert.equal(log.changeStats()[0].n, 3);
    });

    await t.test('the slowest changes come first', () => {
        const log = createTimingLog({ minSamples: 1 });
        const play = (from, to, ms, at) => {
            log.lock(from, at); log.attempt(from, at + 200, true);
            log.lock(to, at + 1000); log.attempt(to, at + 1000 + ms, true);
        };
        play('Am', 'F', 2400, 0);
        play('G', 'C', 500, 10000);
        play('D', 'Bm', 1500, 20000);
        const changes = log.changeStats();
        // Chaining the pairs also produces the joins between them (F>G, C>D),
        // which is correct - those are real changes the player made. What
        // matters is that the list is ordered slowest first.
        for (let i = 1; i < changes.length; i++) {
            assert.ok(changes[i - 1].medMs >= changes[i].medMs, 'not sorted slowest first');
        }
        const named = new Map(changes.map(c => [`${c.from}>${c.to}`, c.medMs]));
        assert.equal(named.get('Am>F'), 2400);
        assert.equal(named.get('D>Bm'), 1500);
        assert.equal(named.get('G>C'), 500);
        assert.equal(changes[0].medMs, 2400, 'the slowest change leads');
    });

    await t.test('stray and malformed input never throws', () => {
        const log = createTimingLog();
        // A strum with nothing locked.
        log.attempt('Am', 100, true);
        // A strum against something other than the locked target.
        log.lock('Am', 0);
        log.attempt('F', 100, true);
        log.lock(null, 0);
        log.attempt('Am', 100, false);
        log.lock('C', undefined);
        log.attempt('C', undefined, true);
        assert.ok(Array.isArray(log.chordStats()));
        assert.ok(Array.isArray(log.changeStats()));
        log.reset();
        assert.deepEqual(log.chordStats(), []);
        assert.deepEqual(log.changeStats(), []);
    });

    await t.test('the summary reports the run', () => {
        const html = buildSummary({
            won: true, kills: 12, bossKills: 2, accuracy: 78, hullLost: 1,
            wave: 6, totalWaves: 6, livery: 'Ace', labelMode: 'fade',
            songTitle: 'Wish You Were Here',
            chords: [
                { name: 'Em7', box: 0, seen: 8, hits: 3, change: '2.4s' },
                { name: 'G', box: 4, seen: 6, hits: 6, change: '0.6s' },
            ],
            weakest: [{ name: 'Em7' }],
            changes: [{ from: 'Em7', to: 'G', n: 5, medMs: 2400 }],
            movement: { mastered: 1, learning: 3, slipped: 1 },
        });
        assert.ok(html.includes('Sector cleared'));
        assert.ok(html.includes('Wish You Were Here'));
        assert.ok(html.includes('Em7'));
        assert.ok(html.includes('2.4s'), 'the slowest change should be shown');
        assert.ok(html.includes('mastered 1'));
        assert.ok(html.includes('38%'), 'Em7 hit rate is 3 of 8');
        assert.ok(html.includes('Ear training'));
    });

    await t.test('the summary adapts to the mode and to missing data', () => {
        const bare = buildSummary({ kills: 3, accuracy: 50, wave: 2, totalWaves: 6 });
        assert.ok(bare.includes('Cockpit breached'));
        assert.ok(!bare.includes('Song'));
        assert.ok(!bare.includes('Chords'), 'no chord table without chord data');
        assert.ok(!bare.includes('Progress'));
        // Practice has no waves, no boss and no hull, so it must not claim any.
        const practice = buildSummary({ practice: true, kills: 20, accuracy: 66 });
        assert.ok(practice.includes('Practice session complete'));
        assert.ok(!practice.includes('Reached wave'));
        assert.ok(!practice.includes('Hull lost'));
        assert.ok(!practice.includes('Bosses'));
        // And it never throws on nothing at all.
        assert.ok(buildSummary({}).length > 0);
        assert.ok(buildSummary(null).length > 0);
    });

    await t.test('library text reaches the summary as data, not markup', () => {
        assert.equal(esc('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
        assert.equal(esc(null), '');
        // Song and chord names are free text written by whoever made the chart.
        const html = buildSummary({
            songTitle: '<img src=x onerror=alert(1)>',
            chords: [{ name: '<script>', box: 0, seen: 1, hits: 0 }],
            changes: [{ from: '"><i>', to: 'G', n: 3, medMs: 900 }],
            weakest: [{ name: '</div>' }],
        });
        // The payloads survive as visible TEXT - that is the point - but no
        // angle bracket from library data reaches the output unescaped, so
        // nothing they contain can become markup.
        assert.ok(!html.includes('<script'));
        assert.ok(!html.includes('<img'));
        assert.ok(html.includes('&lt;script&gt;'));
        assert.ok(html.includes('&lt;/div&gt;'));
        assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'),
            'the payload should be shown, defanged, not silently dropped');
        assert.ok(html.includes('&quot;&gt;&lt;i&gt;'));

        // Stronger than spot-checking payloads: strip the tags the summary
        // itself emits, and no angle bracket should be left anywhere.
        const ours = html.replace(/<\/?(?:div|b|span)(?: [^<>]*)?>/g, '');
        assert.ok(!ours.includes('<'), `unescaped '<' survived: ${ours.slice(0, 120)}`);
        assert.ok(!ours.includes('>'), `unescaped '>' survived: ${ours.slice(0, 120)}`);
    });
});
