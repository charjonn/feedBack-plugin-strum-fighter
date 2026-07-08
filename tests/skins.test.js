'use strict';
// Coverage for assets/modules/skins.js (ESM, loaded via dynamic import).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MOD = pathToFileURL(
    path.join(__dirname, '..', 'assets', 'modules', 'skins.js')).href;

test('skins module', async (t) => {
    const { SKINS, ownedSkinIds, resolveSkin } = await import(MOD);

    await t.test('skin table is complete and default is always unlockable', () => {
        for (const [id, skin] of Object.entries(SKINS)) {
            assert.equal(skin.id, id);
            for (const key of ['label', 'accent', 'accentHex', 'tracer', 'muzzle', 'light', 'star', 'badge']) {
                assert.ok(skin[key] != null, `${id}: missing ${key}`);
            }
        }
        assert.equal(SKINS.default.unlock, null);
    });

    await t.test('ownedSkinIds strips the plugin prefix and tolerates bare ids', () => {
        const owned = ownedSkinIds(
            ['strum_fighter:skin_ace', 'skin_squad', 'other_game:skin_x', 42, null],
            'strum_fighter');
        assert.ok(owned.has('skin_ace'));
        assert.ok(owned.has('skin_squad'));
        assert.ok(owned.has('other_game:skin_x')); // foreign scope kept as-is
        assert.equal(owned.size, 3);               // non-strings dropped
    });

    await t.test('ownedSkinIds handles non-array unlocks', () => {
        assert.equal(ownedSkinIds(null, 'strum_fighter').size, 0);
        assert.equal(ownedSkinIds(undefined, 'strum_fighter').size, 0);
        assert.equal(ownedSkinIds('skin_ace', 'strum_fighter').size, 0);
    });

    await t.test('auto resolves to highest unlocked livery', () => {
        assert.equal(resolveSkin('auto', new Set()).id, 'default');
        assert.equal(resolveSkin('auto', new Set(['skin_ace'])).id, 'ace');
        assert.equal(resolveSkin('auto', new Set(['skin_ace', 'skin_squad'])).id, 'squad');
        assert.equal(resolveSkin(undefined, new Set(['skin_squad'])).id, 'squad');
    });

    await t.test('explicit unlocked pick is honored', () => {
        const owned = new Set(['skin_ace', 'skin_squad']);
        assert.equal(resolveSkin('ace', owned).id, 'ace');
        assert.equal(resolveSkin('default', owned).id, 'default');
    });

    await t.test('locked or unknown pick degrades to best unlocked', () => {
        assert.equal(resolveSkin('squad', new Set(['skin_ace'])).id, 'ace');
        assert.equal(resolveSkin('squad', new Set()).id, 'default');
        assert.equal(resolveSkin('no-such-skin', new Set(['skin_ace'])).id, 'ace');
    });

    await t.test('owned accepts arrays or garbage', () => {
        assert.equal(resolveSkin('auto', ['skin_ace']).id, 'ace');
        assert.equal(resolveSkin('auto', 'skin_ace').id, 'default');
        assert.equal(resolveSkin('auto', null).id, 'default');
    });
});
