'use strict';
// The modifier list is written twice: declaratively in plugin.json (which the
// host reads to render the picker) and again in the spec game.js registers.
// They must agree, or the picker offers options the game ignores. This test
// scrapes the second one out of the source, so the regex is a little brittle
// by nature — if it stops matching it fails loudly rather than silently
// passing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Pull the `modifiers: [ ... ]` array out of the postSpec({...}) call.
function scrapeSpecModifiers(src) {
    const start = src.indexOf('modifiers: [');
    assert.ok(start >= 0, 'no `modifiers: [` in game.js');
    let depth = 0, end = -1;
    for (let i = src.indexOf('[', start); i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    assert.ok(end > start, 'unbalanced modifiers array in game.js');
    const body = src.slice(start, end + 1);

    const out = [];
    const entry = /\{\s*id:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'\s*,\s*default:\s*'([^']*)'\s*,\s*values:\s*\[([^\]]*)\]\s*\}/g;
    let m;
    while ((m = entry.exec(body))) {
        out.push({
            id: m[1],
            label: m[2],
            default: m[3],
            values: m[4].split(',').map(v => v.trim().replace(/^'|'$/g, '')).filter(Boolean),
        });
    }
    return out;
}

test('plugin.json and game.js declare the same modifiers', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
    const spec = scrapeSpecModifiers(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'));
    const declared = manifest.minigame.modifiers;

    assert.ok(spec.length > 0, 'scraped no modifiers from game.js — has the call changed shape?');
    assert.deepEqual(spec.map(m => m.id).sort(), declared.map(m => m.id).sort(),
        'modifier ids differ between plugin.json and game.js');

    const byId = new Map(spec.map(m => [m.id, m]));
    for (const d of declared) {
        const g = byId.get(d.id);
        assert.equal(g.label, d.label, `${d.id}: label`);
        assert.equal(g.default, d.default, `${d.id}: default`);
        assert.deepEqual(g.values, d.values, `${d.id}: values`);
        // A default the picker cannot offer would strand the game on a value
        // the player can never get back to.
        assert.ok(d.values.includes(d.default), `${d.id}: default not among values`);
    }
});
