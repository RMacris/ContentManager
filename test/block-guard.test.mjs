import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const blockGuard = readFileSync(new URL('../src/content/block-guard.js', import.meta.url), 'utf8');

test('removed rules stop affecting an already-open YouTube-style SPA page', () => {
  const pattern = '.*example\\.com/blocked.*';
  let initialRead;
  let storageChangeListener;
  const windowListeners = new Map();
  const window = {
    location: { href: 'https://safe.example/start' },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) ?? [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    dispatchEvent(event) {
      for (const listener of windowListeners.get(event.type) ?? []) listener(event);
      return true;
    },
  };
  const history = {
    pushState(_state, _title, url) {
      window.location.href = new URL(url, window.location.href).href;
    },
    replaceState(_state, _title, url) {
      window.location.href = new URL(url, window.location.href).href;
    },
  };
  const chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test-extension/${path}`,
    },
    storage: {
      sync: {
        get(_defaults, callback) {
          initialRead = () => callback({ blockedUrls: [{ urlPattern: pattern, ruleId: 'removed' }] });
        },
      },
      onChanged: {
        addListener(listener) {
          storageChangeListener = listener;
        },
      },
    },
  };

  runInNewContext(blockGuard, {
    chrome,
    window,
    history,
    document: {},
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    MutationObserver: class {
      observe() {}
    },
  });

  storageChangeListener({
    blockedUrls: { oldValue: [{ urlPattern: pattern, ruleId: 'removed' }], newValue: [] },
  }, 'sync');
  initialRead();
  history.pushState({}, '', 'https://example.com/blocked');

  assert.equal(window.location.href, 'https://example.com/blocked');
});
