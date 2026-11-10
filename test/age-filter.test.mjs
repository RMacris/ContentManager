import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const ageCore = readFileSync(new URL('../src/content/age-core.js', import.meta.url), 'utf8');
const keywordCore = readFileSync(new URL('../src/content/keyword-core.js', import.meta.url), 'utf8');
const channelRules = readFileSync(new URL('../src/content/channel-rules.js', import.meta.url), 'utf8');
const settingsContract = readFileSync(new URL('../src/shared/settings-contract.js', import.meta.url), 'utf8');
const youtubeDom = readFileSync(new URL('../src/content/youtube-dom.js', import.meta.url), 'utf8');
const contentRuntime = readFileSync(new URL('../src/content/content-runtime.js', import.meta.url), 'utf8');
const contentSettings = readFileSync(new URL('../src/content/content-settings.js', import.meta.url), 'utf8');
const ageFilter = readFileSync(new URL('../src/content/age-filter.js', import.meta.url), 'utf8');

test('the YouTube filter applies the saved age limit and reacts to changes', () => {
  const oldCard = createVideoCard('há 6 dias');
  const olderCard = createVideoCard('há 8 dias');
  const cards = [oldCard, olderCard];
  const timers = [];
  const storageListeners = [];
  let readSettings;

  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector.includes('data-yti-old')) return cards.filter((card) => card.getAttribute('data-yti-old') === '1');
      if (selector === 'ytd-rich-shelf-renderer') return [];
      return cards;
    },
    createTreeWalker(node) {
      let index = 0;
      return {
        nextNode() {
          if (index >= node.textParts.length) return null;
          return { data: node.textParts[index++] };
        },
      };
    },
  };

  const chrome = {
    runtime: { lastError: null, id: 'extension-id' },
    storage: {
      sync: {
        get(defaults, callback) {
          readSettings = () => callback({ ...defaults, hideOldVideos: true, hideGamesAndAds: false, maxAgeHours: 72 });
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
  };

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`, {
    chrome,
    document,
    location: { pathname: '/' },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    setInterval() {},
  });

  storageListeners[0]({
    hideOldVideos: { newValue: false },
    hideGamesAndAds: { newValue: false },
    maxAgeHours: { newValue: 168 },
  }, 'sync');
  readSettings();
  flushTimers(timers);
  assert.equal(oldCard.style.display, '', 'a settings change beats a stale initial read');
  assert.equal(olderCard.style.display, '');

  storageListeners[0]({ hideOldVideos: { newValue: true } }, 'sync');
  flushTimers(timers);
  assert.equal(oldCard.style.display, '', 'a 6-day recommendation remains at a 7-day limit');
  assert.equal(olderCard.style.display, 'none', 'an 8-day recommendation is hidden at a 7-day limit');

  storageListeners[0]({ maxAgeHours: { newValue: 120 } }, 'sync');
  flushTimers(timers);
  assert.equal(oldCard.style.display, 'none', 'changing the saved limit recalculates existing cards');

  storageListeners[0]({ hideOldVideos: { newValue: false } }, 'sync');
  flushTimers(timers);
  assert.equal(oldCard.style.display, '', 'turning the age filter off restores hidden cards');
  assert.equal(olderCard.style.display, '');
});

test('the subscription-only mode keeps recency and keyword filters on top of the channel restriction', () => {
  const subscribedRecent = createKeywordCard({
    title: 'Novidade da semana',
    channel: 'Tech Brasil',
    handle: '@TechBR',
    ageText: 'há 6 horas',
  });
  const subscribedOld = createKeywordCard({
    title: 'Vídeo antigo',
    channel: 'Tech Brasil',
    handle: '@TechBR',
    ageText: 'há 8 dias',
  });
  const subscribedKeyword = createKeywordCard({
    title: 'ChatGPT avançado',
    channel: 'Tech Brasil',
    handle: '@TechBR',
    ageText: 'há 1 dia',
  });
  const otherRecent = createKeywordCard({
    title: 'Outro canal',
    channel: 'Canal Ruim',
    handle: '@ruim',
    ageText: 'há 1 hora',
  });
  const promoted = createKeywordCard({
    title: 'Anúncio',
    channel: 'Outro canal',
    promoted: true,
  });
  const shorts = createKeywordCard({
    title: 'Shorts',
    channel: 'Outro canal',
    shorts: true,
  });
  const selectedOnly = createKeywordCard({
    title: 'Receita de bolo',
    channel: 'Cozinha da Vovó',
    handle: '@vovo',
    ageText: 'há 2 horas',
  });
  const cards = [subscribedRecent, subscribedOld, subscribedKeyword, otherRecent, promoted, shorts, selectedOnly];

  const run = runChannelModeScenario({
    settings: {
      hideOldVideos: true,
      hideGamesAndAds: false,
      maxAgeHours: 72,
      channelMode: 'subscribed',
      blockKeywords: true,
      blockedKeywords: ['chatgpt'],
      blockedChannels: [],
      selectedChannels: [{ name: 'Cozinha da Vovó', handle: '@vovo' }],
      allowedChannels: [{ name: 'Canal Ruim', handle: '@ruim' }],
    },
    catalog: [
      { name: 'Tech Brasil', handle: '@TechBR' },
      { name: 'Cozinha da Vovó', handle: '@vovo' },
    ],
    cards,
  });
  flushTimers(run.timers);

  assert.equal(subscribedRecent.style.display, '', 'a recent subscribed channel stays');
  assert.equal(subscribedOld.style.display, 'none', 'recency still applies inside the mode');
  assert.equal(subscribedKeyword.style.display, 'none', 'keywords still apply inside the mode');
  assert.equal(otherRecent.style.display, 'none', 'a channel outside the subscriptions is hidden');
  assert.equal(promoted.style.display, 'none', 'promoted cards have no channel and are hidden');
  assert.equal(shorts.style.display, '', 'Shorts stay outside the mode, as before');
  assert.equal(selectedOnly.style.display, '', 'the subscribed source ignores the selected list');

  run.change({ channelMode: { newValue: 'selected' } });
  flushTimers(run.timers);
  assert.equal(subscribedRecent.style.display, 'none', 'a subscribed channel outside the selected list is hidden');
  assert.equal(selectedOnly.style.display, '', 'the selected channel stays');
  assert.equal(otherRecent.style.display, 'none', 'the allowlist does not bypass the mode');

  run.change({ selectedChannels: { newValue: [] } });
  flushTimers(run.timers);
  assert.equal(otherRecent.style.display, '', 'an empty source fails open instead of blanking the feed');
  assert.equal(subscribedKeyword.style.display, 'none', 'keywords still apply with an empty source');

  run.change({ channelMode: { newValue: 'off' } });
  flushTimers(run.timers);
  assert.equal(otherRecent.style.display, '', 'turning the mode off restores the normal filter');
  assert.equal(subscribedOld.style.display, 'none', 'the normal age filter still hides the old card');
  assert.equal(promoted.style.display, '', 'the games/ads switch was off, so the promo returns');
});

test('the subscription-only mode follows the catalog as it is collected', () => {
  const subscribed = createKeywordCard({
    title: 'Novidade',
    channel: 'Tech Brasil',
    handle: '@TechBR',
    ageText: 'há 2 horas',
  });
  const other = createKeywordCard({
    title: 'Outro canal',
    channel: 'Canal Ruim',
    handle: '@ruim',
    ageText: 'há 2 horas',
  });

  const run = runChannelModeScenario({
    settings: {
      hideOldVideos: true,
      hideGamesAndAds: false,
      maxAgeHours: 72,
      channelMode: 'subscribed',
      blockKeywords: false,
      blockedKeywords: [],
      blockedChannels: [],
      selectedChannels: [],
      allowedChannels: [],
    },
    catalog: [],
    cards: [subscribed, other],
  });
  flushTimers(run.timers);
  assert.equal(subscribed.style.display, '', 'without a catalog the mode fails open');
  assert.equal(other.style.display, '', 'without a catalog the mode fails open');

  run.change(
    { channelCatalog: { newValue: { channels: [{ name: 'Tech Brasil', handle: '@TechBR' }] } } },
    'local',
  );
  flushTimers(run.timers);
  assert.equal(subscribed.style.display, '', 'the collected subscribed channel stays');
  assert.equal(other.style.display, 'none', 'the newly known non-subscribed channel is hidden');
});

function runChannelModeScenario({ settings, catalog = [], cards }) {
  const timers = [];
  const storageListeners = [];

  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector.includes('data-yti-old')) return cards.filter((card) => card.getAttribute('data-yti-old') === '1');
      if (selector === 'ytd-rich-shelf-renderer') return [];
      return cards;
    },
    createTreeWalker(node) {
      let index = 0;
      return {
        nextNode() {
          if (index >= node.textParts.length) return null;
          return { data: node.textParts[index++] };
        },
      };
    },
  };

  const chrome = {
    runtime: { lastError: null, id: 'extension-id' },
    storage: {
      sync: {
        get(defaults, callback) {
          callback({ ...defaults, ...settings });
        },
      },
      local: {
        get(defaults, callback) {
          callback({ ...defaults, channelCatalog: { channels: catalog } });
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
  };

  runInNewContext(
    `${ageCore}\n${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`,
    {
      chrome,
      document,
      location: { pathname: '/' },
      NodeFilter: { SHOW_TEXT: 4 },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
      setInterval() {},
    },
  );

  return {
    timers,
    change(changes, area = 'sync') {
      storageListeners[0](changes, area);
    },
  };
}

function createVideoCard(ageText) {
  const attributes = new Map();
  const metadata = { textParts: [ageText], querySelectorAll: () => [] };
  return {
    parentElement: null,
    style: {
      display: '',
      setProperty(name, value) {
        if (name === 'display') this.display = value;
      },
      removeProperty(name) {
        if (name === 'display') this.display = '';
      },
    },
    matches: () => false,
    querySelector(selector) {
      return selector.includes('/watch?v=') ? {} : null;
    },
    querySelectorAll(selector) {
      return selector.includes('#metadata-line') ? [metadata] : [];
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
}

test('the content filter takes its age bound and default from the shared contract', () => {
  const withinBound = createVideoCard('há 364 dias');
  const beyondBound = createVideoCard('há 366 dias');
  const wide = runAgeLimitScenario({
    contractSource: settingsContract,
    maxAgeHours: 8760,
    cards: [withinBound, beyondBound],
  });
  wide.read();
  flushTimers(wide.timers);
  assert.equal(withinBound.style.display, '', '364 days stays inside the 365-day contract bound');
  assert.equal(beyondBound.style.display, 'none', '366 days is outside the 365-day contract bound');

  const twentyDays = createVideoCard('há 20 dias');
  const narrowedContract = settingsContract.replace('max: 365 * HOURS_PER_DAY', 'max: 720');
  assert.notEqual(narrowedContract, settingsContract, 'the simulated contract change is applied');
  const narrow = runAgeLimitScenario({
    contractSource: narrowedContract,
    maxAgeHours: 72,
    cards: [twentyDays],
  });
  narrow.read();
  flushTimers(narrow.timers);
  assert.equal(twentyDays.style.display, 'none', 'a 20-day card is hidden at the contract default');

  narrow.change({ maxAgeHours: { newValue: 1440 } });
  flushTimers(narrow.timers);
  assert.equal(
    twentyDays.style.display,
    'none',
    '60 days is invalid under the narrowed contract and the filter falls back to the contract default 3 days',
  );
});

function runAgeLimitScenario({ contractSource, maxAgeHours, cards }) {
  const timers = [];
  const storageListeners = [];
  let read = () => {};

  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector.includes('data-yti-old')) return cards.filter((card) => card.getAttribute('data-yti-old') === '1');
      if (selector === 'ytd-rich-shelf-renderer') return [];
      return cards;
    },
    createTreeWalker(node) {
      let index = 0;
      return {
        nextNode() {
          if (index >= node.textParts.length) return null;
          return { data: node.textParts[index++] };
        },
      };
    },
  };

  const chrome = {
    runtime: { lastError: null, id: 'extension-id' },
    storage: {
      sync: {
        get(defaults, callback) {
          read = () =>
            callback({
              ...defaults,
              hideOldVideos: true,
              hideGamesAndAds: false,
              maxAgeHours,
              blockKeywords: false,
            });
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
  };

  runInNewContext(
    `${ageCore}\n${keywordCore}\n${channelRules}\n${contractSource}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`,
    {
      chrome,
      document,
      location: { pathname: '/' },
      NodeFilter: { SHOW_TEXT: 4 },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
      setInterval() {},
    },
  );

  return {
    timers,
    read,
    change(changes) {
      storageListeners[0](changes, 'sync');
    },
  };
}

test('keyword and channel blocking reuse the age-filter hiding and undo on toggle-off', () => {
  const aiCard = createKeywordCard({ title: 'Testando o ChatGPT', channel: 'Tech Brasil' });
  const channelCard = createKeywordCard({ title: 'Vlog de gato', channel: 'Canal Ruim' });
  const cleanCard = createKeywordCard({ title: 'Receita de bolo', channel: 'Cozinha da Vovó' });
  const cards = [aiCard, channelCard, cleanCard];
  const timers = [];
  const storageListeners = [];
  let readSettings;

  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector.includes('data-yti-old')) return cards.filter((card) => card.getAttribute('data-yti-old') === '1');
      if (selector === 'ytd-rich-shelf-renderer') return [];
      return cards;
    },
    createTreeWalker(node) {
      let index = 0;
      return {
        nextNode() {
          if (index >= node.textParts.length) return null;
          return { data: node.textParts[index++] };
        },
      };
    },
  };

  const chrome = {
    runtime: { lastError: null, id: 'extension-id' },
    storage: {
      sync: {
        get(defaults, callback) {
          readSettings = () =>
            callback({
              ...defaults,
              hideOldVideos: false,
              hideGamesAndAds: false,
              blockKeywords: true,
              blockedKeywords: ['chatgpt', 'ia'],
              blockedChannels: ['Canal Ruim'],
            });
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
  };

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`, {
    chrome,
    document,
    location: { pathname: '/' },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    setInterval() {},
  });

  readSettings();
  flushTimers(timers);
  assert.equal(aiCard.style.display, 'none', 'a title keyword hides the card');
  assert.equal(channelCard.style.display, 'none', 'a blocked channel name hides the card');
  assert.equal(cleanCard.style.display, '', 'a clean card stays visible');
  assert.equal(cleanCard.getAttribute('data-yti-old'), null, 'clean cards carry no hiding mark');

  storageListeners[0]({ blockKeywords: { newValue: false } }, 'sync');
  flushTimers(timers);
  assert.equal(aiCard.style.display, '', 'turning the keyword filter off restores hidden cards');
  assert.equal(channelCard.style.display, '');
  assert.equal(cleanCard.style.display, '');

  storageListeners[0](
    { blockedKeywords: { newValue: ['chatgpt'] }, blockedChannels: { newValue: [] }, blockKeywords: { newValue: true } },
    'sync',
  );
  flushTimers(timers);
  assert.equal(aiCard.style.display, 'none', 'a saved list change recalculates existing cards');
  assert.equal(channelCard.style.display, '', 'emptying the channel list restores its cards');
});

function createKeywordCard({
  title,
  channel,
  titleHidden = false,
  handle = '',
  ageText = '',
  promoted = false,
  shorts = false,
}) {
  const attributes = new Map();
  const titleNode = { textParts: [title], querySelectorAll: () => [] };
  const metadataNode = {
    textParts: ageText === '' ? [] : [ageText],
    querySelectorAll: () => [],
  };
  const channelNode = {
    textParts: [channel],
    querySelectorAll: () => [],
    getAttribute(name) {
      return name === 'href' && handle !== '' ? '/' + handle : null;
    },
  };
  return {
    parentElement: null,
    textParts: [title, channel],
    style: {
      display: '',
      setProperty(name, value) {
        if (name === 'display') this.display = value;
      },
      removeProperty(name) {
        if (name === 'display') this.display = '';
      },
    },
    matches(selector) {
      if (promoted && (selector.includes('ad-') || selector.includes('promoted') || selector.includes('mini-game'))) {
        return true;
      }
      if (shorts && selector.includes('shorts')) return true;
      return false;
    },
    querySelector(selector) {
      if (selector.includes('/watch?v=')) return {};
      if (selector === '#video-title' && !titleHidden) return titleNode;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('#metadata-line')) return [metadataNode];
      if (selector.includes('ytd-channel-name')) return [channelNode];
      return [];
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
}

test('an unknown card layout still matches keywords using the whole card text', () => {
  const unknownLayoutCard = createKeywordCard({
    title: 'Entendendo IA generativa',
    channel: 'Tech Brasil',
    titleHidden: true,
  });
  const cards = [unknownLayoutCard];
  const timers = [];
  let readSettings;

  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector.includes('data-yti-old')) return cards.filter((card) => card.getAttribute('data-yti-old') === '1');
      if (selector === 'ytd-rich-shelf-renderer') return [];
      return cards;
    },
    createTreeWalker(node) {
      let index = 0;
      return {
        nextNode() {
          if (index >= node.textParts.length) return null;
          return { data: node.textParts[index++] };
        },
      };
    },
  };

  const chrome = {
    runtime: { lastError: null, id: 'extension-id' },
    storage: {
      sync: {
        get(defaults, callback) {
          readSettings = () =>
            callback({
              ...defaults,
              hideOldVideos: false,
              hideGamesAndAds: false,
              blockKeywords: true,
              blockedKeywords: ['ia generativa'],
              blockedChannels: [],
            });
        },
      },
      onChanged: {
        addListener() {},
      },
    },
  };

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`, {
    chrome,
    document,
    location: { pathname: '/' },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    setInterval() {},
  });

  readSettings();
  flushTimers(timers);
  assert.equal(unknownLayoutCard.style.display, 'none', 'the whole card text finds the keyword when the title is unknown');
});

function flushTimers(timers) {
  while (timers.length > 0) timers.shift()();
}

test('a live filter is not duplicated; an orphaned one is revived by re-injection', () => {
  const live = runFilterScripts({ runtimeId: 'extension-id' });
  assert.equal(live.storageListeners.length, 1);
  assert.equal(live.timers.length, 1, 'a live instance schedules its scans');
  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`, live.sandbox);
  assert.equal(live.storageListeners.length, 1, 're-running over a live instance does nothing');

  const orphaned = runFilterScripts({ runtimeId: undefined });
  assert.equal(orphaned.storageListeners.length, 1);
  assert.equal(orphaned.timers.length, 0, 'an orphaned instance stops scheduling scans instead of fighting the new one');
  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`, orphaned.sandbox);
  assert.equal(orphaned.storageListeners.length, 2, 're-running over an orphaned instance revives it');
});

function runFilterScripts({ runtimeId }) {
  const timers = [];
  const storageListeners = [];
  const cards = [createKeywordCard({ title: 'Receita de bolo', channel: 'Cozinha' })];
  const chrome = {
    runtime: { lastError: null, id: runtimeId },
    storage: {
      sync: {
        get(defaults, callback) {
          callback({
            ...defaults,
            hideOldVideos: true,
            hideGamesAndAds: false,
            blockKeywords: false,
            blockedKeywords: [],
            blockedChannels: [],
          });
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
  };
  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector.includes('data-yti-old')) return cards.filter((card) => card.getAttribute('data-yti-old') === '1');
      if (selector === 'ytd-rich-shelf-renderer') return [];
      return cards;
    },
    createTreeWalker(node) {
      let index = 0;
      return {
        nextNode() {
          if (index >= node.textParts.length) return null;
          return { data: node.textParts[index++] };
        },
      };
    },
  };
  const sandbox = {
    chrome,
    document,
    location: { pathname: '/' },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    setInterval() {},
  };
  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`, sandbox);
  return { sandbox, storageListeners, timers };
}

test('allowlisted channels stay visible even with matching keywords and blocked channels', () => {
  const allowedByName = createKeywordCard({ title: 'ChatGPT avançado', channel: 'Tech Brasil' });
  const allowedByHandle = createKeywordCard({ title: 'ChatGPT na prática', channel: 'Outro Nome', handle: '@TechBR' });
  const blockedCard = createKeywordCard({ title: 'ChatGPT avançado', channel: 'Canal Ruim' });
  const cards = [allowedByName, allowedByHandle, blockedCard];
  const timers = [];
  let readSettings;

  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector.includes('data-yti-old')) return cards.filter((card) => card.getAttribute('data-yti-old') === '1');
      if (selector === 'ytd-rich-shelf-renderer') return [];
      return cards;
    },
    createTreeWalker(node) {
      let index = 0;
      return {
        nextNode() {
          if (index >= node.textParts.length) return null;
          return { data: node.textParts[index++] };
        },
      };
    },
  };

  const chrome = {
    runtime: { lastError: null, id: 'extension-id' },
    storage: {
      sync: {
        get(defaults, callback) {
          readSettings = () =>
            callback({
              ...defaults,
              hideOldVideos: false,
              hideGamesAndAds: false,
              blockKeywords: true,
              blockedKeywords: ['chatgpt'],
              blockedChannels: ['Canal Ruim'],
              allowedChannels: [{ name: 'Tech Brasil', handle: '@TechBR' }],
            });
        },
      },
      onChanged: {
        addListener() {},
      },
    },
  };

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`, {
    chrome,
    document,
    location: { pathname: '/' },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    setInterval() {},
  });

  readSettings();
  flushTimers(timers);
  assert.equal(allowedByName.style.display, '', 'the allowlist wins by channel name');
  assert.equal(allowedByHandle.style.display, '', 'the allowlist wins by handle too');
  assert.equal(blockedCard.style.display, 'none', 'a channel outside the allowlist is still filtered');
});

test('changing only the age limit or keyword list does not drop the allowlist', () => {
  const allowedCard = createKeywordCard({
    title: 'ChatGPT avançado',
    channel: 'Tech Brasil',
    handle: '@TechBR',
  });
  const blockedCard = createKeywordCard({ title: 'ChatGPT avançado', channel: 'Canal Ruim' });
  const cards = [allowedCard, blockedCard];
  const timers = [];
  const storageListeners = [];
  let readSettings;

  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector.includes('data-yti-old')) return cards.filter((card) => card.getAttribute('data-yti-old') === '1');
      if (selector === 'ytd-rich-shelf-renderer') return [];
      return cards;
    },
    createTreeWalker(node) {
      let index = 0;
      return {
        nextNode() {
          if (index >= node.textParts.length) return null;
          return { data: node.textParts[index++] };
        },
      };
    },
  };

  const chrome = {
    runtime: { lastError: null, id: 'extension-id' },
    storage: {
      sync: {
        get(defaults, callback) {
          readSettings = () =>
            callback({
              ...defaults,
              hideOldVideos: true,
              hideGamesAndAds: false,
              maxAgeHours: 72,
              blockKeywords: true,
              blockedKeywords: ['chatgpt'],
              blockedChannels: ['Canal Ruim'],
              allowedChannels: [{ name: 'Tech Brasil', handle: '@TechBR' }],
            });
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
  };

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${ageFilter}`, {
    chrome,
    document,
    location: { pathname: '/' },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    setInterval() {},
  });

  readSettings();
  flushTimers(timers);
  assert.equal(allowedCard.style.display, '', 'the allowlist wins before any change');
  assert.equal(blockedCard.style.display, 'none', 'a channel outside the allowlist is filtered');

  storageListeners[0]({ maxAgeHours: { newValue: 168 } }, 'sync');
  flushTimers(timers);
  assert.equal(allowedCard.style.display, '', 'changing only maxAgeHours keeps the allowlist');
  assert.equal(blockedCard.style.display, 'none');

  storageListeners[0]({ blockedKeywords: { newValue: ['chatgpt', 'ia'] } }, 'sync');
  flushTimers(timers);
  assert.equal(allowedCard.style.display, '', 'changing only the keyword list keeps the allowlist');
});
