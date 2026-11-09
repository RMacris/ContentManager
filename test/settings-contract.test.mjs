/**
 * O contrato das configurações, sem navegador.
 *
 * O popup e o service worker leem o mesmo global; esta suíte fixa os padrões,
 * os limites e a normalização que os dois adaptadores compartilham. A
 * persistência continua em `background/settings.js` e é exercitada em
 * `extension-flow.test.mjs`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/content/keyword-core.js';
import '../src/content/channel-rules.js';
import '../src/shared/settings-contract.js';

const contract = globalThis.YTISettingsContract;

test('the contract owns the settings defaults, keys and limits', () => {
  assert.deepEqual(contract.DEFAULT_SETTINGS, {
    hideOldVideos: true,
    hideGamesAndAds: true,
    maxAgeDays: 3,
    blockKeywords: false,
  });
  assert.deepEqual(contract.LIMITS, {
    maxAgeDays: { min: 1, max: 365 },
    maxListItems: 100,
    maxItemLength: 60,
    maxAllowedChannels: 50,
  });
  assert.deepEqual([...contract.SETTING_KEYS], [
    'hideOldVideos',
    'hideGamesAndAds',
    'maxAgeDays',
    'blockKeywords',
    'blockedKeywords',
    'blockedChannels',
    'allowedChannels',
  ]);
  assert.equal(contract.isKnownKey('maxAgeDays'), true);
  assert.equal(contract.isKnownKey('blockedChannels'), true);
  assert.equal(contract.isKnownKey('unknown'), false);
});

test('the contract validates the age limit at its boundaries', () => {
  assert.equal(contract.isValidMaxAgeDays(contract.LIMITS.maxAgeDays.min), true);
  assert.equal(contract.isValidMaxAgeDays(contract.LIMITS.maxAgeDays.max), true);

  for (const invalid of [0, 366, 1.5, '3', null, Number.NaN]) {
    assert.equal(contract.isValidMaxAgeDays(invalid), false, `${String(invalid)} is not a valid age`);
  }

  assert.equal(contract.normalizeMaxAgeDays(0), contract.DEFAULT_SETTINGS.maxAgeDays);
  assert.equal(contract.normalizeMaxAgeDays(14), 14);
});

test('the contract normalizes and caps keyword and channel lists', () => {
  assert.equal(contract.normalizeList(null), null);
  assert.equal(contract.normalizeList(undefined), null);
  assert.deepEqual(contract.normalizeList(['GPT-4', 'gpt 4', 'Claude', '']), ['GPT-4', 'Claude']);

  assert.deepEqual(
    contract.normalizeListForSave(['  ChatGPT ', 'chatgpt', 'claude', '']),
    ['ChatGPT', 'claude'],
    'trimmed, deduped by the matcher rule and without blanks',
  );
  assert.equal(
    contract.normalizeListForSave(Array.from({ length: 100 }, (_, index) => `canal ${index}`)).length,
    100,
    'the last allowed item still fits',
  );

  assert.throws(() => contract.normalizeListForSave('chatgpt'), /lista de textos/);
  assert.throws(() => contract.normalizeListForSave(['x'.repeat(61)]), /60 caracteres/);
  assert.throws(
    () => contract.normalizeListForSave(Array.from({ length: 101 }, (_, index) => `canal ${index}`)),
    /100 itens/,
  );
});

test('the contract normalizes and caps the allowed channel list', () => {
  assert.equal(contract.normalizeAllowedList(undefined), null);
  assert.deepEqual(
    contract.normalizeAllowedList([
      { name: ' Tech Brasil ', handle: '@TechBR' },
      { name: 'tech brasil', handle: '@techbr' },
    ]),
    [{ name: 'Tech Brasil', handle: '@TechBR' }],
  );
  assert.deepEqual(
    contract.normalizeAllowedForSave([
      { name: ' Tech Brasil ', handle: ' @TechBR ' },
      { name: 'tech brasil', handle: '@techbr' },
    ]),
    [{ name: 'Tech Brasil', handle: '@TechBR' }],
  );
  assert.equal(
    contract.normalizeAllowedForSave(
      Array.from({ length: 50 }, (_, index) => ({ name: `canal ${index}` })),
    ).length,
    50,
    'the last allowed channel still fits',
  );

  assert.throws(() => contract.normalizeAllowedForSave('Tech'), /lista/);
  assert.throws(() => contract.normalizeAllowedForSave([{ handle: '@canal' }]), /nome/);
  assert.throws(() => contract.normalizeAllowedForSave([{ name: 'x'.repeat(61) }]), /60 caracteres/);
  assert.throws(
    () =>
      contract.normalizeAllowedForSave(
        Array.from({ length: 51 }, (_, index) => ({ name: `canal ${index}` })),
      ),
    /50 canais/,
  );
});

test('the item ceiling stays aligned with the channel rules module', () => {
  assert.equal(contract.LIMITS.maxItemLength, globalThis.YTIChannelRules.MAX_CHANNEL_NAME_LENGTH);
});

test('the contract duplicate checks fold like the matcher', () => {
  assert.equal(contract.hasListItem(['GPT-4'], 'gpt 4'), true);
  assert.equal(contract.hasListItem(['Rick Astley'], 'rick  astley'), true);
  assert.equal(contract.hasListItem([], 'qualquer'), false);
  assert.equal(
    contract.sameChannel(
      { name: 'Tech Brasil', handle: '@TechBR' },
      { name: 'outro nome', handle: '@techbr' },
    ),
    true,
  );
  assert.equal(
    contract.sameChannel(
      { name: 'Tech Brasil', handle: '' },
      { name: 'tech brasil', handle: '' },
    ),
    true,
  );
});
