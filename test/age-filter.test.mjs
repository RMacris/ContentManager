import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const ageCore = readFileSync(new URL('../src/content/age-core.js', import.meta.url), 'utf8');
const keywordCore = readFileSync(new URL('../src/content/keyword-core.js', import.meta.url), 'utf8');
const channelRules = readFileSync(new URL('../src/content/channel-rules.js', import.meta.url), 'utf8');
const youtubeDom = readFileSync(new URL('../src/content/youtube-dom.js', import.meta.url), 'utf8');
const contentRuntime = readFileSync(new URL('../src/content/content-runtime.js', import.meta.url), 'utf8');
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
          readSettings = () => callback({ ...defaults, hideOldVideos: true, hideGamesAndAds: false, maxAgeDays: 3 });
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
  };

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${ageFilter}`, {
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
    maxAgeDays: { newValue: 7 },
  }, 'sync');
  readSettings();
  flushTimers(timers);
  assert.equal(oldCard.style.display, '', 'a settings change beats a stale initial read');
  assert.equal(olderCard.style.display, '');

  storageListeners[0]({ hideOldVideos: { newValue: true } }, 'sync');
  flushTimers(timers);
  assert.equal(oldCard.style.display, '', 'a 6-day recommendation remains at a 7-day limit');
  assert.equal(olderCard.style.display, 'none', 'an 8-day recommendation is hidden at a 7-day limit');

  storageListeners[0]({ maxAgeDays: { newValue: 5 } }, 'sync');
  flushTimers(timers);
  assert.equal(oldCard.style.display, 'none', 'changing the saved limit recalculates existing cards');

  storageListeners[0]({ hideOldVideos: { newValue: false } }, 'sync');
  flushTimers(timers);
  assert.equal(oldCard.style.display, '', 'turning the age filter off restores hidden cards');
  assert.equal(olderCard.style.display, '');
});

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

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${ageFilter}`, {
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

function createKeywordCard({ title, channel, titleHidden = false, handle = '' }) {
  const attributes = new Map();
  const titleNode = { textParts: [title], querySelectorAll: () => [] };
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
    matches: () => false,
    querySelector(selector) {
      if (selector.includes('/watch?v=')) return {};
      if (selector === '#video-title' && !titleHidden) return titleNode;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('#metadata-line')) return [{ textParts: [] }];
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

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${ageFilter}`, {
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
  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${ageFilter}`, live.sandbox);
  assert.equal(live.storageListeners.length, 1, 're-running over a live instance does nothing');

  const orphaned = runFilterScripts({ runtimeId: undefined });
  assert.equal(orphaned.storageListeners.length, 1);
  assert.equal(orphaned.timers.length, 0, 'an orphaned instance stops scheduling scans instead of fighting the new one');
  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${ageFilter}`, orphaned.sandbox);
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
  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${ageFilter}`, sandbox);
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

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${ageFilter}`, {
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
              maxAgeDays: 3,
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

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${ageFilter}`, {
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

  storageListeners[0]({ maxAgeDays: { newValue: 7 } }, 'sync');
  flushTimers(timers);
  assert.equal(allowedCard.style.display, '', 'changing only maxAgeDays keeps the allowlist');
  assert.equal(blockedCard.style.display, 'none');

  storageListeners[0]({ blockedKeywords: { newValue: ['chatgpt', 'ia'] } }, 'sync');
  flushTimers(timers);
  assert.equal(allowedCard.style.display, '', 'changing only the keyword list keeps the allowlist');
});

test('the channels page feeds the subscriptions catalog', () => {
  const messages = [];
  const timers = [];
  const nameNode = { textParts: ['Asmongold TV'] };
  const subscribersNode = { textParts: ['@AsmongoldTV'] };
  const mainLink = { getAttribute: (name) => (name === 'href' ? '/@AsmongoldTV' : null) };
  const avatar = { getAttribute: (name) => (name === 'src' ? '//yt3.example/a.jpg' : null) };
  const channelItem = {
    querySelector(selector) {
      if (selector === '#channel-title #text') return nameNode;
      if (selector === '#subscribers') return subscribersNode;
      if (selector === '#main-link') return mainLink;
      if (selector === '#img') return avatar;
      return null;
    },
  };

  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector === 'ytd-channel-renderer') return [channelItem];
      return [];
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
    runtime: {
      lastError: null,
      id: 'extension-id',
      async sendMessage(message) {
        messages.push(message);
        return { action: 'saveChannelCatalog', ok: true };
      },
    },
    storage: {
      sync: {
        get(defaults, callback) {
          callback({ ...defaults, hideOldVideos: false, hideGamesAndAds: false, blockKeywords: false });
        },
      },
      onChanged: {
        addListener() {},
      },
    },
  };

  runInNewContext(`${ageCore}\n${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${ageFilter}`, {
    chrome,
    document,
    location: { pathname: '/feed/channels' },
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

  flushTimers(timers);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, 'saveChannelCatalog');
  assert.equal(messages[0].channels.length, 1);
  assert.equal(messages[0].channels[0].name, 'Asmongold TV');
  assert.equal(messages[0].channels[0].handle, '@AsmongoldTV');
  assert.equal(messages[0].channels[0].avatarUrl, '//yt3.example/a.jpg');
});
