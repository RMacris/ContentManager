/**
 * O feed único das configurações dos content scripts, sem navegador.
 *
 * O contrato é o dono do schema; este módulo é o dono da leitura, do listener
 * e da ordem. A suíte fixa as três coisas que os adaptadores deixaram de
 * carregar: um storage read, um `onChanged` e uma forma normalizada.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const keywordCore = readFileSync(new URL('../src/content/keyword-core.js', import.meta.url), 'utf8');
const channelRules = readFileSync(new URL('../src/content/channel-rules.js', import.meta.url), 'utf8');
const settingsContract = readFileSync(new URL('../src/shared/settings-contract.js', import.meta.url), 'utf8');
const contentRuntime = readFileSync(new URL('../src/content/content-runtime.js', import.meta.url), 'utf8');
const contentSettings = readFileSync(new URL('../src/content/content-settings.js', import.meta.url), 'utf8');

const DEFAULTS = {
  hideOldVideos: true,
  hideGamesAndAds: true,
  maxAgeDays: 3,
  blockKeywords: false,
  blockedKeywords: [],
  blockedChannels: [],
  allowedChannels: [],
};

/** O feed roda em outro contexto `vm`; compara os dados, não os protótipos. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFeed({ stored = {}, deferredRead = false } = {}) {
  const listeners = [];
  let finishRead = null;

  const chrome = {
    runtime: { id: 'extension-id', lastError: null },
    storage: {
      sync: {
        get(defaults, callback) {
          const value = { ...defaults, ...stored };
          if (deferredRead) finishRead = () => callback(value);
          else callback(value);
        },
      },
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
  };

  const sandbox = { chrome };
  const scripts = `${keywordCore}\n${channelRules}\n${settingsContract}\n${contentRuntime}\n${contentSettings}`;
  runInNewContext(scripts, sandbox, { filename: 'content-settings.js' });
  return {
    feed: sandbox.YTIContentSettings,
    sandbox,
    chrome,
    listeners,
    read() {
      if (finishRead === null) throw new Error('the feed has no pending read');
      finishRead();
      finishRead = null;
    },
    change(changes, area = 'sync') {
      for (const listener of listeners) listener(changes, area);
    },
  };
}

test('one read and one listener deliver the normalized settings to every subscriber', () => {
  const run = createFeed();
  assert.equal(run.listeners.length, 1, 'the feed registers a single storage listener');

  const first = [];
  const second = [];
  run.feed.subscribe((settings) => first.push(settings));
  run.feed.subscribe((settings) => second.push(settings));

  assert.equal(first.length, 1, 'the first subscriber receives the initial state');
  assert.equal(second.length, 1, 'a subscriber arriving after the read receives the current state');
  assert.deepEqual(plain(first[0]), DEFAULTS);
  assert.deepEqual(plain(second[0]), DEFAULTS);
});

test('a change that arrives before the read wins over the stale answer', () => {
  const run = createFeed({ deferredRead: true });
  const seen = [];
  run.feed.subscribe((settings) => seen.push(settings));
  assert.equal(seen.length, 0, 'nothing is delivered before the storage answers');

  run.change({ hideOldVideos: { newValue: false } });
  assert.equal(seen.length, 1, 'the change is delivered without waiting for the read');
  assert.equal(seen[0].hideOldVideos, false);

  run.read();
  assert.equal(seen.length, 1, 'the stale read does not overwrite the newer change');
  assert.equal(seen[0].hideOldVideos, false);
});

test('changing one key keeps the other saved values and normalizes invalid ages', () => {
  const run = createFeed({
    stored: {
      hideOldVideos: false,
      blockedChannels: ['Rick Astley'],
      allowedChannels: [{ name: 'Tech Brasil', handle: '@TechBR' }],
    },
  });
  const seen = [];
  run.feed.subscribe((settings) => seen.push(settings));

  assert.deepEqual(plain(seen.at(-1)), {
    ...DEFAULTS,
    hideOldVideos: false,
    blockedChannels: ['Rick Astley'],
    allowedChannels: [{ name: 'Tech Brasil', handle: '@TechBR' }],
  });

  run.change({ maxAgeDays: { newValue: 14 } });
  assert.equal(seen.at(-1).maxAgeDays, 14);
  assert.deepEqual(plain(seen.at(-1).blockedChannels), ['Rick Astley'], 'an untouched list is preserved');
  assert.deepEqual(plain(seen.at(-1).allowedChannels), [{ name: 'Tech Brasil', handle: '@TechBR' }]);

  run.change({ maxAgeDays: { newValue: 999 } });
  assert.equal(seen.at(-1).maxAgeDays, 3, 'an invalid age falls back to the contract default');
  assert.equal(seen.at(-1).hideOldVideos, false, 'the fallback does not reset the other switches');

  run.change({ blockedChannels: { newValue: ['rick astley', 'Canal Ruim'] } });
  assert.deepEqual(plain(seen.at(-1).blockedChannels), ['rick astley', 'Canal Ruim']);
});

test('an unsubscribe stops delivery and an unrelated area is ignored', () => {
  const run = createFeed();
  const kept = [];
  const dropped = [];
  run.feed.subscribe((settings) => kept.push(settings));
  const unsubscribe = run.feed.subscribe((settings) => dropped.push(settings));

  unsubscribe();
  run.change({ hideOldVideos: { newValue: false } });
  run.change({ hideOldVideos: { newValue: true } }, 'local');

  assert.equal(kept.length, 2, 'the remaining subscriber gets the sync change only');
  assert.equal(dropped.length, 1, 'the unsubscribed listener does not receive the change');
  assert.equal(kept.at(-1).hideOldVideos, false);
});

test('a live feed is kept on re-injection; an orphaned one is replaced', () => {
  const scripts = `${keywordCore}\n${channelRules}\n${settingsContract}\n${contentRuntime}\n${contentSettings}`;
  const live = createFeed();
  const first = live.feed;

  runInNewContext(scripts, live.sandbox, { filename: 'content-settings.js' });
  assert.equal(live.listeners.length, 1, 'a live feed does not register a second listener');
  assert.equal(live.sandbox.YTIContentSettings, first, 'the live interface is kept');

  const orphaned = createFeed();
  orphaned.chrome.runtime.id = null;
  runInNewContext(scripts, orphaned.sandbox, { filename: 'content-settings.js' });
  assert.equal(orphaned.listeners.length, 2, 'an orphaned feed is replaced by the new instance');
  assert.notEqual(orphaned.sandbox.YTIContentSettings, orphaned.feed, 'the new interface replaces the old one');
});
