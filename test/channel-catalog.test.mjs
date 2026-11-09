/**
 * O adaptador do catálogo de inscrições, sem navegador.
 *
 * Colecionar as inscrições era uma segunda funcionalidade dentro do filtro de
 * idade: rodava na página de inscrições mesmo com os três interruptores
 * desligados. Agora o catálogo tem o próprio adaptador do runtime e a suíte
 * cobre a coleta, a página em que ele roda e a reinjeção.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const keywordCore = readFileSync(new URL('../src/content/keyword-core.js', import.meta.url), 'utf8');
const channelRules = readFileSync(new URL('../src/content/channel-rules.js', import.meta.url), 'utf8');
const youtubeDom = readFileSync(new URL('../src/content/youtube-dom.js', import.meta.url), 'utf8');
const contentRuntime = readFileSync(new URL('../src/content/content-runtime.js', import.meta.url), 'utf8');
const channelCatalog = readFileSync(new URL('../src/content/channel-catalog.js', import.meta.url), 'utf8');

const SCRIPTS = `${keywordCore}\n${channelRules}\n${youtubeDom}\n${contentRuntime}\n${channelCatalog}`;

function createChannelItem() {
  const nameNode = { textParts: ['Asmongold TV'] };
  const subscribersNode = { textParts: ['@AsmongoldTV'] };
  const mainLink = { getAttribute: (name) => (name === 'href' ? '/@AsmongoldTV' : null) };
  const avatar = { getAttribute: (name) => (name === 'src' ? '//yt3.example/a.jpg' : null) };
  return {
    querySelector(selector) {
      if (selector === '#channel-title #text') return nameNode;
      if (selector === '#subscribers') return subscribersNode;
      if (selector === '#main-link') return mainLink;
      if (selector === '#img') return avatar;
      return null;
    },
  };
}

function runCatalog({ pathname = '/feed/channels', runtimeId = 'extension-id', items = [createChannelItem()] } = {}) {
  const messages = [];
  const timers = [];
  const intervals = [];

  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector === 'ytd-channel-renderer') return items;
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
      id: runtimeId,
      lastError: null,
      async sendMessage(message) {
        messages.push(message);
        return { action: 'saveChannelCatalog', ok: true };
      },
    },
  };

  const sandbox = {
    chrome,
    document,
    location: { pathname },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
  };

  runInNewContext(SCRIPTS, sandbox, { filename: 'channel-catalog.js' });
  flushTimers(timers);
  return { sandbox, chrome, messages, timers, intervals };
}

function flushTimers(timers) {
  while (timers.length > 0) timers.shift()();
}

test('the channels page feeds the subscriptions catalog', () => {
  const run = runCatalog();

  assert.equal(run.messages.length, 1);
  assert.equal(run.messages[0].action, 'saveChannelCatalog');
  assert.equal(run.messages[0].channels.length, 1);
  assert.equal(run.messages[0].channels[0].name, 'Asmongold TV');
  assert.equal(run.messages[0].channels[0].handle, '@AsmongoldTV');
  assert.equal(run.messages[0].channels[0].avatarUrl, '//yt3.example/a.jpg');
});

test('the catalog does not scan outside the subscriptions page', () => {
  const run = runCatalog({ pathname: '/watch' });
  for (let i = 0; i < run.intervals.length; i += 1) run.intervals[i]();
  flushTimers(run.timers);

  assert.equal(run.messages.length, 0, 'a watch page never collects subscriptions');
});

test('a repeated scan with the same cards does not resend the catalog', () => {
  const run = runCatalog();
  assert.equal(run.messages.length, 1);

  for (let i = 0; i < run.intervals.length; i += 1) run.intervals[i]();
  flushTimers(run.timers);
  assert.equal(run.messages.length, 1, 'the signature suppresses an unchanged batch');
});

test('re-injection over a live catalog keeps one collector and revives an orphaned one', () => {
  const live = runCatalog();
  assert.equal(live.messages.length, 1);
  const firstRuntime = live.sandbox.YTIContentRuntime;

  runInNewContext(SCRIPTS, live.sandbox, { filename: 'channel-catalog.js' });
  flushTimers(live.timers);
  assert.equal(live.sandbox.YTIContentRuntime, firstRuntime, 'the live runtime is kept');
  assert.equal(live.messages.length, 1, 'a live catalog does not register a second collector');

  const orphaned = runCatalog();
  const sendMessage = orphaned.chrome.runtime.sendMessage;
  let idReads = 0;
  // A instância antiga vê o contexto morto; a nova injeção vê a extensão viva.
  Object.defineProperty(orphaned.chrome.runtime, 'id', {
    configurable: true,
    get() {
      idReads += 1;
      return idReads <= 2 ? null : 'extension-id';
    },
  });
  Object.defineProperty(orphaned.chrome.runtime, 'sendMessage', { value: sendMessage });

  runInNewContext(SCRIPTS, orphaned.sandbox, { filename: 'channel-catalog.js' });
  flushTimers(orphaned.timers);
  assert.notEqual(orphaned.sandbox.YTIContentRuntime, firstRuntime, 'an orphaned runtime is replaced');
  assert.equal(orphaned.messages.length, 2, 'the new collector sends the catalog again');
});
