'use strict';
// The plugin's ES modules are fetched with a ?v=BUILD cache-buster, so a module
// change that does not bump BUILD leaves the host serving the previous build
// after a reload — a bug that looks like "my change did nothing". BUILD must
// therefore always equal plugin.json's version.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('BUILD matches the manifest version', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
    const game = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
    const m = game.match(/const BUILD = '([^']+)'/);
    assert.ok(m, "game.js has no `const BUILD = '...'`");
    assert.equal(m[1], manifest.version,
        `BUILD ${m[1]} != plugin.json version ${manifest.version} — bump both`);
});
