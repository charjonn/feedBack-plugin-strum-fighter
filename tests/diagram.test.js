'use strict';
// Coverage for assets/modules/diagram.js — the PURE half only.
//
// layoutChord/revealPlan/boxHeight are deliberately canvas-free so they can be
// checked here; drawChord needs a 2D context and is verified by eye in the
// desktop app instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const mod = (f) => pathToFileURL(
    path.join(__dirname, '..', 'assets', 'modules', f)).href;

test('diagram module', async (t) => {
    const { boxHeight, layoutChord, revealPlan } = await import(mod('diagram.js'));
    const { CHORDS, shapeOf, shapeFromFrets } = await import(mod('chords.js'));

    const BOX = { x: 40, y: 20, w: 120 };

    await t.test('boxHeight is positive and grows with the fret window', () => {
        for (const name of Object.keys(CHORDS)) {
            assert.ok(boxHeight(shapeOf(name), 120) > 0, `${name}: height`);
        }
        const four = shapeFromFrets('a', [-1, -1, 0, 2, 3, 2], null);
        const six = shapeFromFrets('b', [-1, 3, 5, 5, 8, 3], null);
        assert.ok(six.fretWindow > four.fretWindow);
        assert.ok(boxHeight(six, 120) > boxHeight(four, 120));
        // A missing shape still yields a usable default rather than NaN.
        assert.ok(boxHeight(null, 120) > 0);
    });

    await t.test('every drawn element stays inside the box, for every chord', () => {
        for (const name of Object.keys(CHORDS)) {
            const shape = shapeOf(name);
            const L = layoutChord(shape, BOX);
            const x0 = BOX.x, x1 = BOX.x + BOX.w, y0 = BOX.y, y1 = BOX.y + L.h;
            const inside = (px, py, pad, what) => {
                assert.ok(px - pad >= x0 && px + pad <= x1, `${name}: ${what} x=${px}`);
                assert.ok(py - pad >= y0 && py + pad <= y1, `${name}: ${what} y=${py}`);
            };
            for (const sx of L.stringX) inside(sx, L.grid.top, 0, 'string');
            for (const fy of L.fretY) inside(L.grid.left, fy, 0, 'fret');
            for (const m of L.markers) inside(m.x, m.y, m.r, `marker s${m.s}`);
            for (const d of L.dots) inside(d.x, d.y, d.r, `dot s${d.s}`);
            if (L.barre) inside(L.stringX[L.barre.fromS], L.barre.y, L.barre.h / 2, 'barre');
        }
    });

    await t.test('layout matches the shape it was given', () => {
        const L = layoutChord(shapeOf('C'), BOX);
        assert.equal(L.stringX.length, 6);
        assert.equal(L.fretY.length, L.grid.rows + 1);
        assert.equal(L.nut.show, true);
        assert.equal(L.baseLabel, null);
        // C = [-1,3,2,0,1,0]: one muted, two open, three fretted.
        assert.deepEqual(L.markers.map(m => `${m.s}${m.kind}`), ['0x', '3o', '5o']);
        assert.equal(L.dots.length, 3);
        // Strings run low-E first, left to right.
        for (let i = 1; i < 6; i++) assert.ok(L.stringX[i] > L.stringX[i - 1]);
        assert.equal(layoutChord(null, BOX), null);
        assert.equal(layoutChord(shapeOf('C'), null), null);
    });

    await t.test('a shape off the nut is captioned with its fret instead', () => {
        const cm = shapeFromFrets('Cm', [-1, 3, 5, 5, 4, 3], [-1, 1, 3, 4, 2, 1]);
        const L = layoutChord(cm, BOX);
        assert.equal(L.nut.show, false);
        assert.equal(L.baseLabel.text, '3fr');
        // Dots sit in rows of the shifted window, never above it.
        for (const d of L.dots) {
            assert.ok(d.y > L.grid.top && d.y < L.grid.bottom, `dot row ${d.fret}`);
        }
    });

    await t.test('lefty mirrors the string axis and nothing else', () => {
        const shape = shapeOf('G');
        const R = layoutChord(shape, BOX);
        const Lf = layoutChord(shape, Object.assign({}, BOX, { lefty: true }));
        // Mirroring is arithmetic, so compare within a tolerance.
        const near = (a, b, what) =>
            assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
        near(Lf.stringX[0], R.stringX[5], 'low E mirrored');
        near(Lf.stringX[5], R.stringX[0], 'high E mirrored');
        // Low E is now on the right.
        for (let i = 1; i < 6; i++) assert.ok(Lf.stringX[i] < Lf.stringX[i - 1]);
        assert.deepEqual(Lf.fretY, R.fretY);
        assert.equal(Lf.h, R.h);
        for (const sx of Lf.stringX) {
            assert.ok(sx >= BOX.x - 1e-9 && sx <= BOX.x + BOX.w + 1e-9);
        }
    });

    await t.test('barre dots are flagged so the renderer draws a bar, not circles', () => {
        const L = layoutChord(shapeOf('F'), BOX);
        assert.equal(L.barre.fromS, 0);
        assert.equal(L.barre.toS, 5);
        assert.ok(L.barre.h > 0);
        const barred = L.dots.filter(d => d.inBarre).map(d => d.s);
        assert.deepEqual(barred, [0, 4, 5]);
        assert.equal(layoutChord(shapeOf('C'), BOX).barre, null);
    });

    await t.test('revealPlan holds back the scaffolding, then the dots', () => {
        const f = shapeOf('F');   // 6 dots
        const d = shapeOf('D');   // 3 dots
        assert.deepEqual(revealPlan(f, 0), { showScaffold: false, dotCount: 0, topString: -1 });
        assert.deepEqual(revealPlan(f, 0.05), { showScaffold: false, dotCount: 0, topString: -1 });
        // Just past the scaffold threshold: the grid, but not a single dot yet.
        assert.equal(revealPlan(f, 0.09).showScaffold, true);
        assert.equal(revealPlan(f, 0.09).dotCount, 0);
        assert.equal(revealPlan(f, 1).dotCount, 6);
        assert.equal(revealPlan(f, 1).topString, 5);
        assert.equal(revealPlan(d, 1).dotCount, 3);
        // Out-of-range and junk clamp rather than throw.
        assert.equal(revealPlan(f, 5).dotCount, 6);
        assert.equal(revealPlan(f, -3).dotCount, 0);
        assert.equal(revealPlan(f, NaN).dotCount, 0);
        assert.equal(revealPlan(f, undefined).dotCount, 0);
    });

    await t.test('revealPlan is monotonic and never overruns the dot list', () => {
        for (const name of Object.keys(CHORDS)) {
            const shape = shapeOf(name);
            let prev = 0;
            for (let r = 0; r <= 1.00001; r += 0.01) {
                const p = revealPlan(shape, r);
                assert.ok(p.dotCount >= prev, `${name}: dotCount fell at ${r}`);
                assert.ok(p.dotCount <= shape.dots.length, `${name}: overran at ${r}`);
                // topString is the highest string revealed so far.
                const expect = p.dotCount > 0 ? shape.dots[p.dotCount - 1].s : -1;
                assert.equal(p.topString, expect, `${name}: topString at ${r}`);
                prev = p.dotCount;
            }
            assert.equal(prev, shape.dots.length, `${name}: never completed`);
        }
    });

    await t.test('a chord with no fretted strings still lays out', () => {
        const em7 = shapeFromFrets('open', [0, 0, 0, 0, 0, 0], null);
        const L = layoutChord(em7, BOX);
        assert.equal(L.dots.length, 0);
        assert.equal(L.markers.length, 6);
        assert.equal(revealPlan(em7, 1).dotCount, 0);
        assert.equal(revealPlan(em7, 1).topString, -1);
    });
});
