/**
 * Teste do ciclo da colheita: retentativa e chamadas concorrentes.
 *
 * O `chrome` e o `fetch` são dublês: testa-se a coreografia, não o navegador
 * nem a ponte. A retentativa é observada pelo alarme que ela agenda — o efeito
 * que o relógio do navegador enxerga —, nunca por dentro do módulo.
 */
import { collectNow, retryPending } from '../src/background/collector.js';

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

const USER_TAB_ID = 7;
const RETRY_ALARM = 'yti-collect-retry';

/** Dublê do `chrome` — o mínimo que a colheita usa, mais o relógio de alarmes. */
function fakeChrome() {
  const state = {
    sync: {
      bridgeUrl: 'http://127.0.0.1:8791',
      collectEnabled: true,
      collectPeriodMinutes: 60,
      maxCards: 30,
      maximizeBeforeCollect: false,
    },
    local: { bridgeToken: 'token-de-teste' },
    session: {},
    tabs: new Map([
      [USER_TAB_ID, { id: USER_TAB_ID, url: 'https://www.youtube.com/watch?v=abc', status: 'complete', windowId: 1 }],
    ]),
    nextTabId: 100,
    calls: { create: [], update: [], remove: [], script: [] },
    scriptResult: { ok: true, cards: [{ videoId: 'v1' }], buildLabel: 'label' },
    scriptError: null,
    scriptGate: null,
    fetchError: null,
    alarms: { created: [], cleared: [] },
  };

  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...state.sync }),
      },
      local: {
        get: async (defaults) => {
          const out = {};
          for (const key of Object.keys(defaults)) {
            out[key] = key in state.local ? state.local[key] : defaults[key];
          }
          return out;
        },
        set: async (items) => {
          Object.assign(state.local, items);
        },
        remove: async (key) => {
          delete state.local[key];
        },
      },
      session: {
        get: async (defaults) => {
          const out = {};
          for (const key of Object.keys(defaults)) {
            out[key] = key in state.session ? state.session[key] : defaults[key];
          }
          return out;
        },
        set: async (items) => {
          Object.assign(state.session, items);
        },
        remove: async (key) => {
          delete state.session[key];
        },
      },
    },
    alarms: {
      create: async (name, info) => {
        state.alarms.created.push({ name, ...info });
      },
      clear: async (name) => {
        state.alarms.cleared.push(name);
        return true;
      },
    },
    tabs: {
      get: async (tabId) => {
        const tab = state.tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      },
      create: async (props) => {
        const id = state.nextTabId++;
        state.calls.create.push({ id, ...props });
        state.tabs.set(id, { id, url: props.url, status: 'complete', windowId: 1 });
        return { id };
      },
      update: async (tabId, props) => {
        state.calls.update.push({ tabId, ...props });
        const tab = state.tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        Object.assign(tab, props);
        return tab;
      },
      remove: async (tabId) => {
        state.calls.remove.push(tabId);
        state.tabs.delete(tabId);
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: {
      executeScript: async (options) => {
        const tabId = options && options.target ? options.target.tabId : null;
        const tab = state.tabs.get(tabId);
        state.calls.script.push({ tabId, url: tab ? tab.url : null });
        if (state.scriptGate) await state.scriptGate;
        if (state.scriptError) throw new Error(state.scriptError);
        return [{ result: state.scriptResult }];
      },
    },
    windows: {
      get: async (windowId) => ({ id: windowId, state: 'maximized', focused: true }),
      getLastFocused: async () => ({ id: 1, state: 'maximized', focused: true }),
      update: async () => ({ state: 'maximized' }),
    },
  };

  globalThis.fetch = async () => {
    if (state.fetchError) throw new TypeError(state.fetchError);
    return { ok: true, status: 200, json: async () => ({ changed: true }) };
  };

  return state;
}

process.stdout.write('colheita que falha agenda retentativa:\n');
{
  const state = fakeChrome();
  state.scriptError = 'executeScript falhou';
  const summary = await collectNow('alarme');

  check(
    'a colheita falhou',
    summary.ok === false && summary.harvestOk === false,
    `ok=${summary.ok} harvestOk=${summary.harvestOk}`,
  );
  check(
    'agendou a retentativa de 5 minutos',
    state.alarms.created.some((alarm) => alarm.name === RETRY_ALARM && alarm.delayInMinutes === 5),
    JSON.stringify(state.alarms.created),
  );
  check(
    'o modo guardado é repetir a colheita',
    state.local.collectRetryMode === 'harvest',
    String(state.local.collectRetryMode),
  );
}

process.stdout.write('retentativa tem teto:\n');
{
  const state = fakeChrome();
  state.scriptError = 'executeScript falhou';
  await collectNow('alarme');
  await collectNow('retentativa');
  await collectNow('retentativa');
  const scheduled = state.alarms.created.filter((alarm) => alarm.name === RETRY_ALARM);
  check('duas retentativas agendadas; a terceira não', scheduled.length === 2, `agendou ${scheduled.length}`);
}

process.stdout.write('sucesso encerra o episódio de retentativa:\n');
{
  const state = fakeChrome();
  state.scriptError = 'executeScript falhou';
  await collectNow('alarme');
  state.scriptError = null;
  const summary = await collectNow('alarme');

  check('a segunda colheita foi entregue', summary.ok === true && summary.cardCount === 1);
  check('limpou a retentativa pendente', state.alarms.cleared.includes(RETRY_ALARM));
  check(
    'limpou o modo guardado',
    !('collectRetryMode' in state.local),
    JSON.stringify(Object.keys(state.local)),
  );
  check(
    'registrou a entrega boa',
    state.local.lastDelivery && state.local.lastDelivery.ok === true,
    JSON.stringify(state.local.lastDelivery),
  );
}

process.stdout.write('falha de entrega não colhe de novo e agenda só o reenvio:\n');
{
  const state = fakeChrome();
  state.fetchError = 'Failed to fetch';
  const summary = await collectNow('alarme');

  check(
    'a colheita funcionou',
    summary.harvestOk === true && summary.cardCount === 1,
    JSON.stringify(summary),
  );
  check(
    'a entrega falhou',
    summary.ok === false && summary.deliveryOk === false && summary.deliveryKind === 'offline',
    JSON.stringify(summary),
  );
  check(
    'a frase é a de sem conexão, não o erro cru',
    summary.delivery === 'sem conexão com a ponte',
    summary.delivery,
  );
  check('abriu uma aba só', state.calls.create.length === 1, `abriu ${state.calls.create.length}`);
  check(
    'guardou o lote na fila',
    state.local.pendingHarvests.length === 1,
    `fila=${state.local.pendingHarvests.length}`,
  );
  check(
    'agendou a retentativa',
    state.alarms.created.some((alarm) => alarm.name === RETRY_ALARM),
    JSON.stringify(state.alarms.created),
  );
  check(
    'o modo guardado é só reenviar',
    state.local.collectRetryMode === 'delivery',
    String(state.local.collectRetryMode),
  );
}

process.stdout.write('reenvio entrega a fila sem colher e encerra o episódio:\n');
{
  const state = fakeChrome();
  state.fetchError = 'Failed to fetch';
  await collectNow('alarme');
  state.fetchError = null;
  const retry = await retryPending();

  check('o reenvio não abriu aba', state.calls.create.length === 1, `abriu ${state.calls.create.length}`);
  check(
    'o reenvio entregou',
    retry.ok === true && retry.deliveryOk === true && retry.deliveryRetry === true,
    JSON.stringify(retry),
  );
  check('a fila esvaziou', state.local.pendingHarvests.length === 0, `fila=${state.local.pendingHarvests.length}`);
  check(
    'registrou a entrega boa',
    state.local.lastDelivery && state.local.lastDelivery.ok === true,
    JSON.stringify(state.local.lastDelivery),
  );
  check(
    'limpou o modo guardado',
    !('collectRetryMode' in state.local),
    JSON.stringify(Object.keys(state.local)),
  );
  check('limpou o alarme pendente', state.alarms.cleared.includes(RETRY_ALARM));
}

process.stdout.write('chamadas concorrentes colhem uma vez só:\n');
{
  const state = fakeChrome();
  let release = null;
  state.scriptGate = new Promise((resolve) => {
    release = resolve;
  });

  const first = collectNow('alarme');
  const second = collectNow('manual');
  release();
  const [a, b] = await Promise.all([first, second]);

  check('uma única aba foi aberta', state.calls.create.length === 1, `abriu ${state.calls.create.length}`);
  check('as duas chamadas viram o mesmo resultado', a === b);
}

process.stdout.write(failures === 0 ? '\nTUDO OK\n' : `\n${failures} FALHA(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
