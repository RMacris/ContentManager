import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const keywordCore = readFileSync(new URL('../src/content/keyword-core.js', import.meta.url), 'utf8');
const channelRules = readFileSync(new URL('../src/content/channel-rules.js', import.meta.url), 'utf8');
const settingsContract = readFileSync(new URL('../src/shared/settings-contract.js', import.meta.url), 'utf8');
const youtubeDom = readFileSync(new URL('../src/content/youtube-dom.js', import.meta.url), 'utf8');
const contentRuntime = readFileSync(new URL('../src/content/content-runtime.js', import.meta.url), 'utf8');
const contentSettings = readFileSync(new URL('../src/content/content-settings.js', import.meta.url), 'utf8');
const channelButton = readFileSync(new URL('../src/content/channel-button.js', import.meta.url), 'utf8');
const HOST_CLASS = 'yti-channel-block-host';

test('the channel button sits next to the channel name and toggles the block list', async () => {
  const button = runButton();
  const host = findHost(button.container);
  assert.ok(host, 'a button is injected beside the channel name');
  assert.equal(host.getAttribute('data-channel'), 'Rick Astley');
  assert.equal(host.getAttribute('data-surface'), 'watch');
  assert.equal(host.getAttribute('data-blocked'), 'false');
  assert.equal(host.shadowRoot.label.textContent, 'Bloquear');
  assert.equal(host.shadowRoot.button.getAttribute('title'), 'Bloquear Rick Astley');

  button.intervals[0]();
  assert.equal(
    button.container.children.filter((child) => child.className === HOST_CLASS).length,
    1,
    'the periodic sweep does not duplicate the chip',
  );

  host.shadowRoot.button.dispatchEvent('click');
  await flushAsync();

  assert.equal(button.messages.length, 1, 'the click saves through the service worker');
  assert.deepEqual([...button.messages[0].patch.blockedChannels], ['Rick Astley']);
  assert.equal(host.getAttribute('data-blocked'), 'true');
  assert.equal(host.shadowRoot.label.textContent, 'Desbloquear');

  host.shadowRoot.button.dispatchEvent('click');
  await flushAsync();

  assert.deepEqual([...button.messages[1].patch.blockedChannels], []);
  assert.equal(host.getAttribute('data-blocked'), 'false');
  assert.equal(host.shadowRoot.label.textContent, 'Bloquear');
});

test('the chip flips on click, before the save resolves, and rolls back when the save fails', async () => {
  const run = runButton({ deferredSave: true });
  const host = findHost(run.container);
  assert.ok(host);
  assert.equal(host.getAttribute('data-blocked'), 'false');

  host.shadowRoot.button.dispatchEvent('click');
  await flushAsync();

  assert.equal(run.pending.length, 1, 'the save is still waiting for the service worker');
  assert.equal(host.getAttribute('data-blocked'), 'true', 'the chip flips before the save resolves');
  assert.equal(host.shadowRoot.label.textContent, 'Desbloquear');
  assert.equal(host.shadowRoot.button.disabled, true, 'the chip stays pending while saving');

  run.pending[0].reject(new Error('offline'));
  await flushAsync();

  assert.equal(host.getAttribute('data-blocked'), 'false', 'a failed save rolls the chip back');
  assert.equal(host.shadowRoot.label.textContent, 'Bloquear');
  assert.equal(host.shadowRoot.button.disabled, false);
  assert.equal(run.warnings.length, 1, 'the failure stays visible in the console');
});

test('unblocking also switches the chip before the save resolves', async () => {
  const run = runButton({ blockedChannels: ['Rick Astley'], deferredSave: true });
  const host = findHost(run.container);
  assert.equal(host.getAttribute('data-blocked'), 'true');

  host.shadowRoot.button.dispatchEvent('click');
  await flushAsync();

  assert.equal(host.getAttribute('data-blocked'), 'false', 'the chip unblocks before the save resolves');
  assert.deepEqual([...run.messages[0].patch.blockedChannels], []);

  run.pending[0].resolve();
  await flushAsync();

  assert.equal(host.getAttribute('data-blocked'), 'false', 'the saved list keeps the chip unblocked');
  assert.equal(host.shadowRoot.label.textContent, 'Bloquear');
});

test('a storage change and the allowlist update every injected button', async () => {
  const run = runButton();
  const host = findHost(run.container);
  assert.ok(host);

  run.listeners[0]({ blockedChannels: { newValue: ['Rick Astley'] } }, 'sync');
  assert.equal(host.getAttribute('data-blocked'), 'true', 'the popup list updates the injected state');

  run.listeners[0]({ allowedChannels: { newValue: [{ name: 'Rick Astley', handle: '@RickAstley' }] } }, 'sync');
  assert.equal(host.isConnected, false, 'an allowlisted channel loses the block button');

  run.listeners[0]({ allowedChannels: { newValue: [] } }, 'sync');
  flushTimers(run.timers);
  const restored = findHost(run.container);
  assert.ok(restored, 'removing the allowlist brings the button back');
  assert.notEqual(restored, host);
});

test('the allowlist uses normalized identity before the chip is built', () => {
  const byName = runButton({ allowedChannels: [{ name: 'rick astley', handle: '' }] });
  assert.equal(findHost(byName.container), null, 'the name uses the matcher normalization');

  const byHandle = runButton({ allowedChannels: [{ name: 'Outro Nome', handle: '@rickastley' }] });
  assert.equal(findHost(byHandle.container), null, 'the handle ignores @ and case');
});

test('the lockup metadata row gets a compact card button', () => {
  const run = runButton({ withLockup: true });
  const row = run.lockup.querySelector('.ytContentMetadataViewModelMetadataRow');
  const host = row.children.find((child) => child.className === HOST_CLASS);
  assert.ok(host, 'the new lockup layout is supported');
  assert.equal(host.getAttribute('data-channel'), 'Retro Pulse');
  assert.equal(host.getAttribute('data-surface'), 'card');
  assert.equal(host.shadowRoot.label.textContent, '', 'cards keep the label hidden');
});

test('a playlist lockup without a channel avatar or badge is ignored', () => {
  const run = runButton({ lockup: createPlaylistLockup() });
  const row = run.lockup.querySelector('.ytContentMetadataViewModelMetadataRow');
  assert.equal(row.children.some((child) => child.className === HOST_CLASS), false);
});

test('the channel page header gets the same button', () => {
  const run = runButton({ pageTitle: 'Rick Astley', pathname: '/@RickAstleyYT' });
  const host = run.pageTitle.children.find((child) => child.className === HOST_CLASS);
  assert.ok(host, 'the new page header title receives the button');
  assert.equal(host.getAttribute('data-channel'), 'Rick Astley');
  assert.equal(host.getAttribute('data-surface'), 'watch');
});

test('an orphaned chip stops the shared loop and removes its own artifacts', () => {
  const run = runButton({ runtimeId: null });

  assert.equal(run.timers.length, 0, 'no scan timer is scheduled after the context dies');
  assert.equal(run.intervals.length, 0, 'no sweep timer is started after the context dies');
  assert.equal(findHost(run.container), null, 'an orphaned instance does not inject a chip');
  assert.equal(run.document.getElementById('yti-channel-block-style'), null, 'the injected style is removed');
});

test('a hidden tab does not scan the chip, and becoming visible scans again', () => {
  const run = runButton();
  const host = findHost(run.container);
  assert.ok(host);

  run.document.visibilityState = 'hidden';
  host.remove();
  run.intervals[0]();
  assert.equal(findHost(run.container), null, 'the sweep skips a hidden tab');

  run.document.visibilityState = 'visible';
  for (const listener of run.document.listeners.get('visibilitychange') ?? []) listener();
  flushTimers(run.timers);
  const restored = findHost(run.container);
  assert.ok(restored, 'returning to the tab schedules a new scan');

  restored.remove();
  run.intervals[0]();
  assert.ok(findHost(run.container), 'the sweep scans a visible tab again');
});

test('re-injection over a live chip keeps one loop and one storage listener', () => {
  const run = runButton();
  const before = findHost(run.container);

  runInNewContext(`${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${channelButton}`, run.sandbox, {
    filename: 'channel-button.js',
  });

  assert.equal(run.listeners.length, 1, 'the live instance is not duplicated');
  assert.equal(findHost(run.container), before, 'the same chip stays in place');
});

test('the pure channel-list helpers add, match and remove entries', () => {
  const run = runButton({ blockedChannels: ['Rick'] });
  const api = run.sandbox.YTIChannelButton;

  assert.equal(api.isBlocked('Rick Astley'), true, 'a contained name already blocks the channel');
  assert.deepEqual([...api.nextBlockedChannels('Rick Astley')], [], 'unblocking removes the matching entry');
  assert.deepEqual([...api.nextBlockedChannels('Outro Canal')], ['Rick', 'Outro Canal'], 'a new channel is appended');
});

function runButton({
  blockedChannels = [],
  allowedChannels = [],
  withLockup = false,
  lockup = null,
  surface = 'watch',
  pageTitle = null,
  pathname = '/watch',
  deferredSave = false,
  runtimeId = 'extension-id',
} = {}) {
  const container = createChannelContainer('Rick Astley', surface);
  const activeLockup = lockup ?? (withLockup ? createLockup('Retro Pulse') : null);
  const document = new FakeDocument(container, activeLockup, pageTitle);
  const backend = createChrome(blockedChannels, allowedChannels, { deferredSave, runtimeId });
  const warnings = [];
  const timers = [];
  const intervals = [];
  const sandbox = {
    chrome: backend.chrome,
    document,
    location: { pathname },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval() {},
    console: {
      ...console,
      warn(...args) {
        warnings.push(args);
      },
    },
  };

  runInNewContext(`${keywordCore}\n${channelRules}\n${settingsContract}\n${youtubeDom}\n${contentRuntime}\n${contentSettings}\n${channelButton}`, sandbox, {
    filename: 'channel-button.js',
  });
  flushTimers(timers);
  return {
    ...backend,
    container,
    lockup: activeLockup,
    pageTitle: document.pageTitle,
    document,
    sandbox,
    timers,
    intervals,
    warnings,
  };
}

function findHost(container) {
  return container.children.find((child) => child.className === HOST_CLASS) ?? null;
}

function flushTimers(timers) {
  while (timers.length > 0) timers.shift()();
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createChannelContainer(name, surface) {
  const container = new FakeElement('ytd-channel-name');
  const text = new FakeElement('yt-formatted-string');
  text.id = 'text';
  text.textContent = name;
  const link = new FakeElement('a');
  link.setAttribute('href', '/@RickAstley');
  link.textContent = name;
  text.appendChild(link);
  container.appendChild(text);
  container.querySelector = (selector) => {
    if (selector === '#text') return text;
    if (selector.includes('a[href')) return link;
    return null;
  };
  container.closest = (selector) => {
    if (surface === 'card' && selector.includes('ytd-video-renderer')) return new FakeElement('ytd-video-renderer');
    if (surface === 'watch' && selector.includes('ytd-video-owner-renderer')) {
      return new FakeElement('ytd-video-owner-renderer');
    }
    return null;
  };
  return container;
}

function createPlaylistLockup() {
  const lockup = new FakeElement('yt-lockup-view-model');
  const row = new FakeElement('div');
  row.className = 'ytContentMetadataViewModelMetadataRow';
  const first = new FakeElement('span');
  first.className = 'ytContentMetadataViewModelMetadataText';
  first.textContent = 'YouTube';
  const second = new FakeElement('span');
  second.className = 'ytContentMetadataViewModelMetadataText';
  second.textContent = 'Playlist';
  row.appendChild(first);
  row.appendChild(second);
  row.querySelector = (selector) => (selector.includes('MetadataText') ? first : null);
  row.querySelectorAll = (selector) => (selector.includes('MetadataText') ? [first, second] : []);
  lockup.appendChild(row);
  lockup.querySelector = (selector) => {
    if (selector === '.ytContentMetadataViewModelMetadataRow') return row;
    if (selector.includes('yt-avatar')) return null;
    return null;
  };
  return lockup;
}

function createLockup(name) {
  const lockup = new FakeElement('yt-lockup-view-model');
  const row = new FakeElement('div');
  row.className = 'ytContentMetadataViewModelMetadataRow';
  const nameNode = new FakeElement('span');
  nameNode.className = 'ytContentMetadataViewModelMetadataText';
  nameNode.textContent = name;
  const views = new FakeElement('span');
  views.className = 'ytContentMetadataViewModelMetadataText';
  views.textContent = '1,2 mi de visualizações';
  const badge = new FakeElement('span');
  badge.className = 'ytIconWrapperHost';
  row.appendChild(nameNode);
  row.appendChild(views);
  row.appendChild(badge);
  row.querySelector = (selector) => {
    if (selector === '.ytContentMetadataViewModelMetadataText') return nameNode;
    if (selector.includes('ytIconWrapperHost')) return badge;
    return null;
  };
  row.querySelectorAll = (selector) => (selector === '.ytContentMetadataViewModelMetadataText' ? [nameNode, views] : []);
  lockup.appendChild(row);
  lockup.querySelector = (selector) => {
    if (selector === '.ytContentMetadataViewModelMetadataRow') return row;
    if (selector.includes('yt-avatar')) return null;
    return null;
  };
  return lockup;
}

function createChrome(
  blockedChannels,
  allowedChannels,
  { deferredSave = false, runtimeId = 'extension-id' } = {},
) {
  const state = {
    blockedChannels: [...blockedChannels],
    allowedChannels: [...allowedChannels],
  };
  const messages = [];
  const listeners = [];
  const pending = [];

  const save = (message) => {
    state.blockedChannels = [...message.patch.blockedChannels];
    return {
      action: 'saveSettings',
      ok: true,
      settings: {
        blockedChannels: [...state.blockedChannels],
        allowedChannels: [...state.allowedChannels],
      },
    };
  };

  const chrome = {
    runtime: {
      id: runtimeId,
      lastError: null,
      sendMessage(message) {
        messages.push(message);
        if (!deferredSave) return Promise.resolve(save(message));
        return new Promise((resolve, reject) => {
          pending.push({
            resolve() {
              resolve(save(message));
            },
            reject,
          });
        });
      },
    },
    storage: {
      sync: {
        get(defaults, callback) {
          callback({
            ...defaults,
            blockedChannels: [...state.blockedChannels],
            allowedChannels: [...state.allowedChannels],
          });
        },
      },
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
  };
  return { chrome, messages, listeners, state, pending };
}

class FakeShadow {
  constructor() {
    this.innerHTML = '';
    this.button = new FakeElement('button');
    this.label = new FakeElement('span');
    this.label.className = 'label';
    this.button.appendChild(this.label);
  }

  querySelector(selector) {
    if (selector === 'button') return this.button;
    if (selector === '.label') return this.label;
    return null;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.id = '';
    this.textContent = '';
    this.disabled = false;
    this.connected = false;
    this.visible = true;
    this.shadowRoot = null;
    this.style = {};
  }

  appendChild(child) {
    child.parentNode = this;
    child.setConnected(this.connected);
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    child.setConnected(this.connected);
    const index = this.children.indexOf(reference);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentNode = null;
    child.setConnected(false);
    return child;
  }

  remove() {
    if (this.parentNode !== null) this.parentNode.removeChild(this);
    this.setConnected(false);
  }

  setConnected(connected) {
    this.connected = connected;
    for (const child of this.children) child.setConnected(connected);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  get isConnected() {
    return this.connected;
  }

  get previousElementSibling() {
    if (this.parentNode === null) return null;
    const index = this.parentNode.children.indexOf(this);
    return index > 0 ? this.parentNode.children[index - 1] : null;
  }

  get nextElementSibling() {
    if (this.parentNode === null) return null;
    const index = this.parentNode.children.indexOf(this);
    return index !== -1 && index + 1 < this.parentNode.children.length
      ? this.parentNode.children[index + 1]
      : null;
  }

  getClientRects() {
    return this.visible ? [{}] : [];
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return null;
  }

  matches() {
    return false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(type) {
    const event = {
      type,
      preventDefault() {},
      stopPropagation() {},
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  attachShadow() {
    this.shadowRoot = new FakeShadow();
    return this.shadowRoot;
  }
}

class FakeDocument {
  constructor(container, lockup, pageTitle) {
    this.documentElement = new FakeElement('html');
    this.documentElement.setConnected(true);
    this.head = new FakeElement('head');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(container);
    if (lockup !== null) this.documentElement.appendChild(lockup);
    this.container = container;
    this.lockup = lockup;
    this.visibilityState = 'visible';
    this.listeners = new Map();
    this.pageTitle = null;
    if (pageTitle !== null) {
      this.pageTitle = new FakeElement('h1');
      this.pageTitle.textContent = pageTitle;
      this.documentElement.appendChild(this.pageTitle);
    }
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return findById(this.documentElement, id);
  }

  querySelectorAll(selector) {
    if (selector === 'ytd-channel-name') return [this.container];
    if (selector === 'yt-lockup-view-model') return this.lockup === null ? [] : [this.lockup];
    if (selector === 'yt-page-header-renderer h1') return this.pageTitle === null ? [] : [this.pageTitle];
    if (selector === '.yti-channel-block-host') {
      return findAll(this.documentElement, (node) => node.className === HOST_CLASS);
    }
    return [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
}

function findById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found !== null) return found;
  }
  return null;
}

function findAll(node, predicate) {
  const found = [];
  if (predicate(node)) found.push(node);
  for (const child of node.children) found.push(...findAll(child, predicate));
  return found;
}
