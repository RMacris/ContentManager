import assert from 'node:assert/strict';
import test, { before, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const popupHtml = readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
const popupScript = readFileSync(new URL('../src/popup/popup.js', import.meta.url), 'utf8');
const keywordCore = readFileSync(new URL('../src/content/keyword-core.js', import.meta.url), 'utf8');
const channelRules = readFileSync(new URL('../src/content/channel-rules.js', import.meta.url), 'utf8');
const backend = createBackend();

before(async () => {
  globalThis.chrome = backend.chrome;
  await import('../src/background/service-worker.js?popup-test');
});

beforeEach(() => backend.reset());

test('popup saves toggles and the custom age limit across reopen', async () => {
  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');

  const oldVideos = popup.document.getElementById('hideOldVideos');
  assert.equal(oldVideos.checked, true);

  oldVideos.checked = false;
  backend.failNextStorageWrite = true;
  await oldVideos.dispatchEvent('change');
  assert.equal(oldVideos.checked, true, 'failed saves restore the previous checkbox state');
  assert.equal(backend.state.hideOldVideos, true);
  assert.equal(popup.document.getElementById('filterMessage').hidden, false);

  oldVideos.checked = false;
  await oldVideos.dispatchEvent('change');
  assert.equal(backend.state.hideOldVideos, false);

  const ageLimit = popup.document.getElementById('maxAgeDays');
  ageLimit.value = '14';
  await ageLimit.dispatchEvent('change');
  assert.equal(backend.state.maxAgeDays, 14);

  const reopened = mountPopup();
  await reopened.document.dispatchEvent('DOMContentLoaded');
  assert.equal(reopened.document.getElementById('hideOldVideos').checked, false);
  assert.equal(reopened.document.getElementById('maxAgeDays').value, '14');
});

test('blocked URLs can be added and removed from the popup', async () => {
  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');

  const input = popup.document.getElementById('url');
  input.value = '.*youtube.com/shorts.*';
  await popup.document.getElementById('blockForm').dispatchEvent('submit');

  assert.equal(backend.state.blockedUrls.length, 1);
  assert.equal(backend.dynamicRules[0].condition.regexFilter, '.*youtube.com/shorts.*');
  assert.equal(popup.document.getElementById('blockedUrlsList').children.length, 1);

  const removeButton = popup.document.getElementById('blockedUrlsList').children[0].children[1];
  await removeButton.dispatchEvent('click');

  assert.deepEqual(backend.state.blockedUrls, []);
  assert.deepEqual(backend.dynamicRules, []);
  assert.equal(popup.document.getElementById('blockedUrlsList').children.length, 0);
});

test('failed rule updates are visible and do not save a phantom blocked URL', async () => {
  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');

  const input = popup.document.getElementById('url');
  input.value = '.*tiktok.*';
  backend.failNextRuleUpdate = true;
  await popup.document.getElementById('blockForm').dispatchEvent('submit');

  assert.deepEqual(backend.state.blockedUrls, []);
  assert.equal(input.value, '.*tiktok.*');
  assert.match(popup.document.getElementById('message').textContent, /Simulated DNR update failure/);
});

test('synced storage changes remove stale browser rules', async () => {
  const stalePattern = '.*legacy-site.example.*';
  backend.dynamicRules = [{
    id: 1,
    priority: 1,
    action: { type: 'block' },
    condition: { regexFilter: stalePattern, resourceTypes: ['main_frame'] },
  }];

  await backend.emitStorageChange({
    blockedUrls: {
      oldValue: [{ urlPattern: stalePattern, ruleId: 'legacy' }],
      newValue: [],
    },
  });

  assert.deepEqual(backend.state.blockedUrls, []);
  assert.deepEqual(backend.dynamicRules, []);
});

test('popup gives recovery instructions when Chrome has no message receiver', async () => {
  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');

  backend.failNextMessage = true;
  popup.document.getElementById('url').value = '.*example.*';
  await popup.document.getElementById('blockForm').dispatchEvent('submit');

  assert.match(popup.document.getElementById('message').textContent, /chrome:\/\/extensions/);
  assert.deepEqual(backend.state.blockedUrls, []);
});

test('the popup opens the same settings in the browser side panel', async () => {
  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');

  const button = popup.document.getElementById('openSidePanel');
  assert.equal(button.hidden, false, 'the side panel option is visible in the popup');
  await button.dispatchEvent('click');

  assert.equal(backend.sidePanelCalls.length, 1);
  assert.equal(backend.sidePanelCalls[0].windowId, -2, 'it opens in the current browser window');
});

test('the popup loads the shared channel rules before its own script', () => {
  const rulesAt = popupHtml.indexOf('../content/channel-rules.js');
  const popupAt = popupHtml.indexOf('popup.js');

  assert.ok(rulesAt !== -1, 'channel-rules.js is loaded by the popup');
  assert.ok(rulesAt < popupAt, 'channel-rules.js loads before popup.js');
});

test('the channel add form stays above the long keyword badge list', () => {
  const keywordFormAt = popupHtml.indexOf('id="keywordForm"');
  const channelFormAt = popupHtml.indexOf('id="channelForm"');
  const keywordBadgesAt = popupHtml.indexOf('id="keywordBadges"');

  assert.ok(keywordFormAt !== -1 && channelFormAt !== -1, 'both add forms exist');
  assert.ok(keywordFormAt < channelFormAt, 'keyword and channel forms stay together');
  assert.ok(channelFormAt < keywordBadgesAt, 'the channel button is not buried below the keyword badges');
});

test('keyword badges start from the AI preset, are extended and removed', async () => {
  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');

  const badges = popup.document.getElementById('keywordBadges');
  assert.ok(badges.children.length >= 10, 'the AI preset shows up as badges');
  assert.equal(popup.document.getElementById('blockKeywords').checked, false, 'the toggle ships off');
  assert.equal(popup.document.getElementById('blockKeywords').disabled, false, 'the toggle is usable once settings load');
  assert.equal(popup.document.getElementById('keywordEmpty').hidden, true);

  const input = popup.document.getElementById('keywordInput');
  input.value = '  blockchain  ';
  await popup.document.getElementById('keywordForm').dispatchEvent('submit');
  assert.ok(backend.state.blockedKeywords.includes('blockchain'), 'the keyword is trimmed and saved');
  assert.equal(input.value, '', 'the input clears after adding');
  assert.equal(popup.document.getElementById('keywordCount').textContent, String(backend.state.blockedKeywords.length));

  input.value = 'Blockchain';
  await popup.document.getElementById('keywordForm').dispatchEvent('submit');
  assert.equal(
    backend.state.blockedKeywords.filter((keyword) => keyword.toLowerCase() === 'blockchain').length,
    1,
    'a repeated keyword is not added twice',
  );
  assert.match(popup.document.getElementById('keywordMessage').textContent, /já está/);

  const badge = badges.children[0];
  const badgeText = badge.textContent;
  await badge.children[0].dispatchEvent('click');
  assert.equal(backend.state.blockedKeywords.includes(badgeText), false, 'the × button removes the badge');
});

test('list duplicate checks fold punctuation and spacing like the matcher', async () => {
  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');

  const keywordInput = popup.document.getElementById('keywordInput');
  keywordInput.value = 'gpt 4';
  await popup.document.getElementById('keywordForm').dispatchEvent('submit');

  assert.match(popup.document.getElementById('keywordMessage').textContent, /já está/);
  assert.equal(
    backend.state.blockedKeywords.filter((keyword) => keyword === 'gpt 4').length,
    0,
    'the matcher-equivalent keyword is not stored twice',
  );

  const channelInput = popup.document.getElementById('channelInput');
  channelInput.value = 'Rick Astley';
  await popup.document.getElementById('channelForm').dispatchEvent('submit');
  channelInput.value = 'rick  astley';
  await popup.document.getElementById('channelForm').dispatchEvent('submit');

  assert.equal(
    backend.state.blockedChannels.filter((channel) => channel.toLowerCase() === 'rick astley').length,
    1,
    'the matcher-equivalent channel is not stored twice',
  );
});

test('channel badges are added, saved and emptied through the same UI', async () => {
  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');

  const input = popup.document.getElementById('channelInput');
  input.value = 'Canal Ruim';
  await popup.document.getElementById('channelForm').dispatchEvent('submit');
  assert.deepEqual(backend.state.blockedChannels, ['Canal Ruim']);
  assert.equal(popup.document.getElementById('channelEmpty').hidden, true);

  const badges = popup.document.getElementById('channelBadges');
  await badges.children[0].children[0].dispatchEvent('click');
  assert.deepEqual(backend.state.blockedChannels, [], 'the × button empties the channel list');
  assert.equal(popup.document.getElementById('channelEmpty').hidden, false);

  const toggle = popup.document.getElementById('blockKeywords');
  toggle.checked = true;
  await toggle.dispatchEvent('change');
  assert.equal(backend.state.blockKeywords, true);
});

test('saving settings revives the filter in open YouTube tabs', async () => {
  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');
  assert.equal(backend.injections.length, 0);

  const toggle = popup.document.getElementById('blockKeywords');
  toggle.checked = true;
  await toggle.dispatchEvent('change');

  assert.equal(backend.injections.length, 1, 'the toggle re-injects the filter into open tabs');
  assert.deepEqual(backend.injections[0].files, [
    'src/content/age-core.js',
    'src/content/keyword-core.js',
    'src/content/channel-rules.js',
    'src/content/channel-button.js',
    'src/content/age-filter.js',
  ]);
});

test('subscribed channels are searched and added to the allowlist with photo', async () => {
  backend.setChannelCatalog({
    updatedAt: 123,
    channels: [
      { name: 'Tech Brasil', handle: '@TechBR', avatarUrl: 'https://yt3.example/tech.jpg' },
      { name: 'Cozinha da Vovó', handle: '@vovo', avatarUrl: '' },
    ],
  });

  const popup = mountPopup();
  await popup.document.dispatchEvent('DOMContentLoaded');
  assert.match(popup.document.getElementById('allowHint').textContent, /2 canais inscritos/);

  const input = popup.document.getElementById('allowInput');
  input.value = 'tech';
  await input.dispatchEvent('input');

  const suggestions = popup.document.getElementById('allowSuggestions');
  assert.equal(suggestions.hidden, false);
  assert.equal(suggestions.children.length, 1);
  assert.equal(suggestions.children[0].children[0].src, 'https://yt3.example/tech.jpg');

  await suggestions.children[0].dispatchEvent('click');
  assert.deepEqual(backend.state.allowedChannels, [{ name: 'Tech Brasil', handle: '@TechBR' }]);
  assert.equal(popup.document.getElementById('allowInput').value, '', 'the search clears after adding');

  const badges = popup.document.getElementById('allowedBadges');
  assert.equal(badges.children.length, 1);
  assert.equal(badges.children[0].children[0].src, 'https://yt3.example/tech.jpg', 'the badge carries the photo');
  assert.equal(popup.document.getElementById('allowedCount').textContent, '1');

  await badges.children[0].children[2].dispatchEvent('click');
  assert.deepEqual(backend.state.allowedChannels, [], 'the × removes the channel from the allowlist');
  assert.equal(popup.document.getElementById('allowedEmpty').hidden, false);
});

function createBackend() {
  const state = {
    blockedUrls: [],
    hideOldVideos: true,
    hideGamesAndAds: true,
    maxAgeDays: 3,
    blockKeywords: false,
    blockedKeywords: null,
    blockedChannels: null,
    allowedChannels: null,
  };
  const localState = { channelCatalog: null };
  let dynamicRules = [];
  let messageListener;
  let failNextStorageWrite = false;
  let failNextRuleUpdate = false;
  let failNextMessage = false;
  let injections = [];
  let sidePanelCalls = [];
  const storageListeners = [];

  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      getURL: () => 'chrome-extension://test-extension/',
      sendMessage(message) {
        if (failNextMessage) {
          failNextMessage = false;
          return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
        }
        return new Promise((resolve, reject) => {
          if (messageListener === undefined) {
            reject(new Error('No service-worker listener'));
            return;
          }

          const timeout = setTimeout(() => reject(new Error('Service worker did not respond')), 200);
          const sendResponse = (response) => {
            clearTimeout(timeout);
            resolve(response);
          };
          const keepChannelOpen = messageListener(message, {}, sendResponse);
          if (keepChannelOpen !== true) {
            clearTimeout(timeout);
            resolve(keepChannelOpen);
          }
        });
      },
    },
    storage: {
      sync: {
        get(defaults, callback) {
          const value = { ...defaults, ...state };
          if (typeof callback === 'function') queueMicrotask(() => callback(value));
          return Promise.resolve(value);
        },
        set(patch, callback) {
          if (failNextStorageWrite) {
            failNextStorageWrite = false;
            return Promise.reject(new Error('Simulated storage write failure'));
          }

          const changes = {};
          for (const [key, newValue] of Object.entries(patch)) {
            changes[key] = { oldValue: state[key], newValue };
          }
          Object.assign(state, patch);
          storageListeners.forEach((listener) => listener(changes, 'sync'));
          if (typeof callback === 'function') queueMicrotask(callback);
          return Promise.resolve();
        },
      },
      local: {
        async get(defaults) {
          return { ...defaults, ...localState };
        },
        async set(patch) {
          Object.assign(localState, patch);
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
    tabs: {
      async query(queryInfo) {
        return [{ id: 7, url: 'https://www.youtube.com/', queryInfo }];
      },
      async create({ url }) {
        return { id: 8, url };
      },
    },
    windows: { WINDOW_ID_CURRENT: -2 },
    sidePanel: {
      async open(options) {
        sidePanelCalls.push(options);
      },
    },
    scripting: {
      async executeScript({ target, files }) {
        injections.push({ tabId: target.tabId, files: [...files] });
      },
    },
    declarativeNetRequest: {
      async isRegexSupported({ regex }) {
        try {
          new RegExp(regex);
          return { isSupported: true };
        } catch {
          return { isSupported: false };
        }
      },
      async getDynamicRules() {
        return [...dynamicRules];
      },
      async updateDynamicRules({ removeRuleIds, addRules }) {
        if (failNextRuleUpdate) {
          failNextRuleUpdate = false;
          throw new Error('Simulated DNR update failure');
        }
        dynamicRules = [
          ...dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id)),
          ...addRules,
        ];
      },
    },
  };

  return {
    chrome,
    state,
    get dynamicRules() {
      return dynamicRules;
    },
    get injections() {
      return injections;
    },
    get sidePanelCalls() {
      return sidePanelCalls;
    },
    set dynamicRules(value) {
      dynamicRules = value;
    },
    set failNextStorageWrite(value) {
      failNextStorageWrite = value;
    },
    set failNextRuleUpdate(value) {
      failNextRuleUpdate = value;
    },
    set failNextMessage(value) {
      failNextMessage = value;
    },
    async emitStorageChange(changes, area = 'sync') {
      for (const [key, change] of Object.entries(changes)) state[key] = change.newValue;
      await Promise.all(storageListeners.map((listener) => listener(changes, area)));
    },
    setChannelCatalog(catalog) {
      localState.channelCatalog = catalog;
    },
    reset() {
      Object.assign(state, {
        blockedUrls: [],
        hideOldVideos: true,
        hideGamesAndAds: true,
        maxAgeDays: 3,
        blockKeywords: false,
        blockedKeywords: null,
        blockedChannels: null,
        allowedChannels: null,
      });
      localState.channelCatalog = null;
      dynamicRules = [];
      injections = [];
      sidePanelCalls = [];
      failNextStorageWrite = false;
      failNextRuleUpdate = false;
      failNextMessage = false;
    },
  };
}

function mountPopup() {
  const elements = new Map();
  const idPattern = /<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi;
  let match = idPattern.exec(popupHtml);
  while (match !== null) {
    const [, tagName, attributes, id] = match;
    const element = new FakeElement(tagName);
    element.id = id;
    element.type = attributes.match(/\btype="([^"]+)"/i)?.[1] ?? '';
    element.value = attributes.match(/\bvalue="([^"]*)"/i)?.[1] ?? '';
    element.className = attributes.match(/\bclass="([^"]*)"/i)?.[1] ?? '';
    element.checked = /\bchecked(?:\s|>|$)/i.test(attributes);
    element.disabled = /\bdisabled(?:\s|>|$)/i.test(attributes);
    element.hidden = /\bhidden(?:\s|>|$)/i.test(attributes);
    elements.set(id, element);
    match = idPattern.exec(popupHtml);
  }

  const documentListeners = new Map();
  const document = {
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) ?? [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    async dispatchEvent(type) {
      for (const listener of documentListeners.get(type) ?? []) await listener({ type });
    },
  };

  runInNewContext(`${keywordCore}\n${channelRules}\n${popupScript}`, { chrome: backend.chrome, document }, { filename: 'popup.js' });
  return { document };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.listeners = new Map();
    this.children = [];
    this.attributes = new Map();
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.className = '';
    this.type = '';
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatchEvent(type) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
    return event;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  set innerHTML(value) {
    this.children = [];
    this._innerHTML = value;
  }

  get innerHTML() {
    return this._innerHTML ?? '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  focus() {}
}
