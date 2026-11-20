import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const contentRuntime = readFileSync(new URL('../src/content/content-runtime.js', import.meta.url), 'utf8');

test('two adapters share one observer, one sweep and their own scan floors', () => {
  const run = createRuntime();
  const scans = [];

  run.core.register({ scan: () => scans.push('filter'), minScanIntervalMs: 500 });
  run.core.register({ scan: () => scans.push('chip'), minScanIntervalMs: 250 });

  assert.equal(run.observers.length, 1, 'one observer watches the tree for both adapters');
  assert.equal(run.intervals.length, 1, 'one sweep timer serves both adapters');
  assert.equal(run.timers.length, 2, 'each adapter keeps its own throttle');

  flushTimers(run.timers);
  assert.deepEqual(scans, ['filter', 'chip']);
});

test('a hidden document skips both scans and a visible one schedules them again', () => {
  const run = createRuntime();
  const scans = [];
  run.core.register({ scan: () => scans.push('filter') });
  run.core.register({ scan: () => scans.push('chip') });
  flushTimers(run.timers);
  scans.length = 0;

  run.document.visibilityState = 'hidden';
  run.intervals[0]();
  assert.deepEqual(scans, [], 'the sweep does not touch the DOM while hidden');

  run.document.visibilityState = 'visible';
  run.listeners.get('visibilitychange')();
  flushTimers(run.timers);
  assert.deepEqual(scans, ['filter', 'chip'], 'returning to the tab scans every adapter');
});

test('an orphaned runtime stops the single loop and calls every adapter onStop', () => {
  const run = createRuntime();
  const stopped = [];
  run.core.register({ scan() {}, onStop: () => stopped.push('filter') });
  run.core.register({ scan() {}, onStop: () => stopped.push('chip') });

  run.chrome.runtime.id = null;
  run.intervals[0]();

  assert.deepEqual(stopped, ['filter', 'chip'], 'each adapter cleans what it created');
  assert.equal(run.observers[0].disconnected, true, 'the observer is disconnected once');
  assert.equal(run.core.isRunning(), false, 'the shared loop is stopped');
});

test('re-injection keeps a live runtime and replaces an orphaned one', () => {
  const run = createRuntime();
  const first = run.core;

  runInNewContext(contentRuntime, run.sandbox);
  assert.equal(run.sandbox.YTIContentRuntime, first, 'a live runtime is kept');

  run.chrome.runtime.id = null;
  runInNewContext(contentRuntime, run.sandbox);
  assert.notEqual(run.sandbox.YTIContentRuntime, first, 'an orphaned runtime is replaced');
});

test('stop removes the document listeners it attached', () => {
  const run = createRuntime();
  run.core.register({ scan() {} });

  assert.ok(run.listeners.has('yt-navigate-finish'), 'the SPA navigation listener is attached');
  assert.ok(run.listeners.has('visibilitychange'), 'the visibility listener is attached');

  run.core.stop();

  assert.equal(run.listeners.has('yt-navigate-finish'), false, 'the navigation listener is removed');
  assert.equal(run.listeners.has('visibilitychange'), false, 'the visibility listener is removed');
  assert.equal(run.observers[0].disconnected, true, 'the observer is disconnected once');
});

test('a stopped runtime releases every adapter while a live one still scans', () => {
  const run = createRuntime();
  const scans = [];
  run.core.register({ scan: () => scans.push('chip') });

  assert.equal(run.core.adapterCount(), 1, 'the live runtime keeps its adapter');
  flushTimers(run.timers);
  assert.deepEqual(scans, ['chip'], 'a live runtime still scans');

  run.core.stop();

  assert.equal(run.core.adapterCount(), 0, 'a stopped runtime lets go of its adapters');
  assert.equal(run.core.isRunning(), false, 'the shared loop is stopped');

  run.core.scheduleScan();
  flushTimers(run.timers);
  assert.deepEqual(scans, ['chip'], 'a stopped runtime never scans again');
});

test('stop still runs every adapter cleanup when the document cannot remove listeners', () => {
  const run = createRuntime();
  const stopped = [];
  run.core.register({ scan() {}, onStop: () => stopped.push('chip') });
  delete run.document.removeEventListener;

  run.core.stop();

  assert.deepEqual(stopped, ['chip'], 'the adapter cleanup is not skipped');
  assert.equal(run.core.adapterCount(), 0, 'the adapters are still released');
});

test('stop before the document is ready drops the DOMContentLoaded listener too', () => {
  const run = createRuntime({ documentElement: null });
  run.core.register({ scan() {} });

  assert.ok(run.listeners.has('DOMContentLoaded'), 'the deferred start waits for the document');

  run.core.stop();

  assert.equal(run.listeners.has('DOMContentLoaded'), false, 'the deferred listener is removed');
  assert.equal(run.core.isRunning(), false, 'the shared loop is stopped');
});

function createRuntime({ runtimeId = 'extension-id', documentElement = {} } = {}) {
  const timers = [];
  const intervals = [];
  const observers = [];
  const listeners = new Map();
  const document = {
    documentElement,
    visibilityState: 'visible',
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const chrome = { runtime: { id: runtimeId } };
  const sandbox = {
    chrome,
    document,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
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
    Date,
  };

  runInNewContext(contentRuntime, sandbox);
  return { sandbox, core: sandbox.YTIContentRuntime, chrome, document, timers, intervals, observers, listeners };
}

function flushTimers(timers) {
  while (timers.length > 0) timers.shift()();
}
