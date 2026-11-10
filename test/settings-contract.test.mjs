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
    maxAgeHours: 72,
    channelMode: 'off',
    blockKeywords: false,
  });
  assert.deepEqual(contract.LIMITS, {
    maxAgeHours: { min: 1, max: 8760 },
    maxListItems: 100,
    maxItemLength: 60,
    maxAllowedChannels: 50,
    maxSelectedChannels: 50,
  });
  assert.deepEqual([...contract.SETTING_KEYS], [
    'hideOldVideos',
    'hideGamesAndAds',
    'maxAgeHours',
    'channelMode',
    'blockKeywords',
    'blockedKeywords',
    'blockedChannels',
    'selectedChannels',
    'allowedChannels',
  ]);
  assert.equal(contract.isKnownKey('maxAgeHours'), true);
  assert.equal(contract.isKnownKey('channelMode'), true);
  assert.equal(contract.isKnownKey('selectedChannels'), true);
  assert.equal(contract.isKnownKey('blockedChannels'), true);
  assert.equal(contract.isKnownKey('maxAgeDays'), false, 'the old day key is read-only');
  assert.equal(contract.isKnownKey('unknown'), false);
});

test('the contract validates the age limit at its boundaries', () => {
  assert.equal(contract.isValidMaxAgeHours(contract.LIMITS.maxAgeHours.min), true);
  assert.equal(contract.isValidMaxAgeHours(contract.LIMITS.maxAgeHours.max), true);

  for (const invalid of [0, 8761, 1.5, '3', null, Number.NaN]) {
    assert.equal(contract.isValidMaxAgeHours(invalid), false, `${String(invalid)} is not a valid age`);
  }

  assert.equal(contract.normalizeMaxAgeHours(0), contract.DEFAULT_SETTINGS.maxAgeHours);
  assert.equal(contract.normalizeMaxAgeHours(6), 6);
  assert.equal(contract.normalizeMaxAgeHours(null, 14), 14 * contract.HOURS_PER_DAY);
});

test('the contract normalizes a full settings state', () => {
  assert.deepEqual(contract.normalizeSettings({}), {
    hideOldVideos: true,
    hideGamesAndAds: true,
    maxAgeHours: 72,
    channelMode: 'off',
    blockKeywords: false,
    blockedKeywords: [],
    blockedChannels: [],
    selectedChannels: [],
    allowedChannels: [],
  });

  assert.deepEqual(
    contract.normalizeSettings({
      hideOldVideos: false,
      hideGamesAndAds: 0,
      maxAgeHours: 99999,
      channelMode: 'selected',
      blockKeywords: 'yes',
      blockedKeywords: ['GPT-4', 'gpt 4'],
      blockedChannels: ['Rick'],
      selectedChannels: [{ name: 'Tech Brasil', handle: '@TechBR' }],
      allowedChannels: [{ name: 'Tech Brasil', handle: '@TechBR' }],
    }),
    {
      hideOldVideos: false,
      hideGamesAndAds: true,
      maxAgeHours: 72,
      channelMode: 'selected',
      blockKeywords: false,
      blockedKeywords: ['GPT-4'],
      blockedChannels: ['Rick'],
      selectedChannels: [{ name: 'Tech Brasil', handle: '@TechBR' }],
      allowedChannels: [{ name: 'Tech Brasil', handle: '@TechBR' }],
    },
  );

  assert.equal(
    contract.normalizeSettings({ channelMode: 'subscribed' }).channelMode,
    'subscribed',
  );
  assert.equal(contract.normalizeSettings({ channelMode: 'closed' }).channelMode, 'off');
});

test('the contract validates the channel mode', () => {
  assert.deepEqual([...contract.CHANNEL_MODES], ['off', 'selected', 'subscribed']);
  for (const valid of contract.CHANNEL_MODES) {
    assert.equal(contract.isValidChannelMode(valid), true);
  }
  for (const invalid of ['', 'on', 'all', null, 1]) {
    assert.equal(contract.isValidChannelMode(invalid), false, `${String(invalid)} is not a mode`);
  }
  assert.equal(contract.normalizeChannelMode('closed'), 'off');
});

test('the contract reads the old day setting as a migration fallback', () => {
  assert.equal(contract.LEGACY_AGE_KEY, 'maxAgeDays');
  assert.equal(contract.normalizeSettings({ maxAgeDays: 14 }).maxAgeHours, 336);
  assert.equal(
    contract.normalizeSettings({ maxAgeDays: 14, maxAgeHours: 6 }).maxAgeHours,
    6,
    'the canonical hours win once they exist',
  );
  assert.equal(
    contract.normalizeSettings({ maxAgeDays: 999 }).maxAgeHours,
    72,
    'an invalid legacy value falls back to the default',
  );
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

test('the contract normalizes and caps the selected channel list', () => {
  assert.equal(contract.normalizeSelectedList(undefined), null);
  assert.deepEqual(
    contract.normalizeSelectedList([
      { name: ' Tech Brasil ', handle: '@TechBR' },
      { name: 'tech brasil', handle: '@techbr' },
    ]),
    [{ name: 'Tech Brasil', handle: '@TechBR' }],
  );
  assert.deepEqual(
    contract.normalizeSelectedForSave([
      { name: ' Tech Brasil ', handle: ' @TechBR ' },
      { name: 'tech brasil', handle: '@techbr' },
    ]),
    [{ name: 'Tech Brasil', handle: '@TechBR' }],
  );
  assert.equal(
    contract.normalizeSelectedForSave(
      Array.from({ length: 50 }, (_, index) => ({ name: `canal ${index}` })),
    ).length,
    50,
    'the last selected channel still fits',
  );

  assert.throws(() => contract.normalizeSelectedForSave('Tech'), /lista/);
  assert.throws(() => contract.normalizeSelectedForSave([{ handle: '@canal' }]), /nome/);
  assert.throws(() => contract.normalizeSelectedForSave([{ name: 'x'.repeat(61) }]), /60 caracteres/);
  assert.throws(
    () =>
      contract.normalizeSelectedForSave(
        Array.from({ length: 51 }, (_, index) => ({ name: `canal ${index}` })),
      ),
    /50 canais/,
  );
});

test('the item ceiling stays aligned with the channel rules module', () => {
  assert.equal(contract.LIMITS.maxItemLength, globalThis.YTIChannelRules.MAX_CHANNEL_NAME_LENGTH);
});

test('the contract leaves list identity to the channel-rules owner', () => {
  assert.equal(contract.hasListItem, undefined, 'the contract does not re-export the item matcher');
  assert.equal(contract.sameChannel, undefined, 'the contract does not re-export channel identity');
  assert.equal(globalThis.YTIChannelRules.hasListItem(['GPT-4'], 'gpt 4'), true);
  assert.equal(
    globalThis.YTIChannelRules.sameChannel(
      { name: 'Tech Brasil', handle: '@TechBR' },
      { name: 'outro nome', handle: '@techbr' },
    ),
    true,
  );
});
