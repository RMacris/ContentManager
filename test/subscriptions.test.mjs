/**
 * Teste da coleta das inscrições: aba própria, extração e entrega.
 *
 * O `chrome` e o `fetch` são dublês: testa-se a coreografia, não o navegador nem
 * a ponte. O que este teste protege:
 * - a aba do usuário nunca é consultada nem tocada;
 * - a coleta abre a própria aba em segundo plano, extrai e fecha ao fim;
 * - o payload entregue à ponte leva os canais, a origem e o carimbo de tempo;
 * - duas chamadas concorrentes compartilham a rodada;
 * - falha (extração, lista vazia, ponte fora do ar) não deixa aba para trás.
 */
import { collectSubscriptions } from '../src/background/subscriptions.js';

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

const USER_TAB_ID = 7;
const USER_TAB_URL = 'https://www.youtube.com/watch?v=abc';
const SUBS_URL = 'https://www.youtube.com/feed/channels';
const BRIDGE_URL = 'http://127.0.0.1:8791/subscriptions';

const CHANNELS = [
  {
    channelId: 'UCsBjURrPoezykLs9EqgamOA',
    handle: 'Fireship',
    title: 'Fireship',
    avatarUrl: 'https://yt3.ggpht.com/fire.jpg',
    subscribersText: '4,29 mi de inscritos',
  },
  {
    channelId: 'UCaO6VoaYJv4kS-TQO_M-N_g',
    handle: 'devemdobro',
    title: 'Dev em Dobro',
    avatarUrl: null,
    subscribersText: null,
  },
];

/** Dublê do `chrome` — o mínimo que a coleta usa, mais o relógio de navegação. */
function fakeChrome() {
  const state = {
    sync: {
      bridgeUrl: 'http://127.0.0.1:8791',
      collectEnabled: true,
      collectPeriodMinutes: 60,
      maxCards: 30,
      maxSubscriptions: 1000,
      maximizeBeforeCollect: false,
    },
    local: { bridgeToken: 'token-de-teste' },
    session: {},
    tabs: new Map([
      [USER_TAB_ID, { id: USER_TAB_ID, url: USER_TAB_URL, status: 'complete', windowId: 1 }],
    ]),
    nextTabId: 100,
    calls: { query: 0, create: [], update: [], remove: [], script: [] },
    scriptResult: { ok: true, channels: CHANNELS, hasMore: false, pages: 2, stopReason: 'complete' },
    scriptError: null,
    scriptGate: null,
    fetchCalls: [],
    fetchError: null,
    listeners: [],
    /** Resposta crua da ponte quando o teste quer fugir do dublê padrão. */
    bridgeBody: null,
  };

  state.finishNavigation = (tabId, url) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    tab.url = url;
    tab.status = 'complete';
    for (const listener of state.listeners.slice()) {
      listener(tabId, { status: 'complete', url });
    }
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
    tabs: {
      query: async () => {
        state.calls.query += 1;
        return [...state.tabs.values()];
      },
      get: async (tabId) => {
        const tab = state.tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      },
      create: async (props) => {
        const id = state.nextTabId++;
        state.calls.create.push({ id, ...props });
        state.tabs.set(id, {
          id,
          url: props.url,
          status: 'complete',
          windowId: 1,
          active: props.active === true,
        });
        return { id };
      },
      update: async (tabId, props) => {
        state.calls.update.push({ tabId, ...props });
        const tab = state.tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        if (typeof props.url === 'string') {
          // Navegação de verdade: a página antiga continua no ar (completa) até a
          // nova ficar pronta — só um evento de `complete` da carga nova vale.
          setTimeout(() => state.finishNavigation(tabId, props.url), 0);
          return tab;
        }
        Object.assign(tab, props);
        return tab;
      },
      remove: async (tabId) => {
        state.calls.remove.push(tabId);
        if (!state.tabs.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
        state.tabs.delete(tabId);
      },
      onUpdated: {
        addListener: (listener) => {
          state.listeners.push(listener);
        },
        removeListener: (listener) => {
          state.listeners = state.listeners.filter((candidate) => candidate !== listener);
        },
      },
    },
    scripting: {
      executeScript: async (options) => {
        const tabId = options && options.target ? options.target.tabId : null;
        const tab = state.tabs.get(tabId);
        state.calls.script.push({ tabId, url: tab ? tab.url : null, args: options.args });
        if (state.scriptGate) await state.scriptGate;
        if (state.scriptError) throw new Error(state.scriptError);
        return [{ result: state.scriptResult }];
      },
    },
    windows: {
      get: async (windowId) => ({ id: windowId, state: 'normal', focused: true }),
      getLastFocused: async () => ({ id: 1, state: 'normal', focused: true }),
      update: async () => ({ state: 'maximized' }),
    },
    runtime: {
      getManifest: () => ({ version: '1.7-teste' }),
    },
  };

  globalThis.fetch = async (url, options) => {
    state.fetchCalls.push({
      url: String(url),
      method: options?.method,
      headers: options?.headers,
      body: options?.body ? JSON.parse(options.body) : null,
    });
    if (state.fetchError) throw new Error(state.fetchError);
    if (state.bridgeBody !== null) {
      return { ok: true, status: 200, json: async () => state.bridgeBody };
    }
    const parsed = options?.body ? JSON.parse(options.body) : null;
    return { ok: true, status: 200, json: async () => ({ stored: parsed?.channels?.length ?? 0 }) };
  };

  return state;
}

process.stdout.write('a coleta das inscrições:\n');
{
  const state = fakeChrome();
  const summary = await collectSubscriptions('manual');

  check('a coleta deu certo', summary.ok === true, String(summary.error ?? summary.delivery));
  check('contou os dois canais', summary.channelCount === 2, String(summary.channelCount));
  check('a entrega foi registrada como entregue', summary.delivery === 'entregue', String(summary.delivery));
  check('nunca consultou as abas do navegador', state.calls.query === 0, `consultou ${state.calls.query}x`);
  check('aba do usuário não foi tocada', state.tabs.get(USER_TAB_ID).url === USER_TAB_URL);
  check(
    'abriu a própria aba em segundo plano na página de inscrições',
    state.calls.create.length === 1 &&
      state.calls.create[0].active === false &&
      state.calls.create[0].url === SUBS_URL,
    JSON.stringify(state.calls.create),
  );
  check(
    'extraiu da página de inscrições',
    state.calls.script.length === 1 && state.calls.script[0].url === SUBS_URL,
    JSON.stringify(state.calls.script),
  );
  check(
    'fechou a própria aba',
    state.calls.remove.includes(state.calls.create[0].id) && !state.tabs.has(state.calls.create[0].id),
  );
  check('não sobrou posse registrada', state.session.ownedSubscriptionsTabId === undefined);

  check('entregou uma vez à ponte', state.fetchCalls.length === 1, `entregou ${state.fetchCalls.length}x`);
  const call = state.fetchCalls[0];
  check('no caminho das inscrições', call.url === BRIDGE_URL, call.url);
  check('com o token no cabeçalho', call.headers['x-yti-token'] === 'token-de-teste');
  check('com os canais no corpo', call.body.channels.length === 2 && call.body.channels[0].handle === 'Fireship');
  check('com a origem da coleta', call.body.source === SUBS_URL, String(call.body.source));
  check('com o carimbo de tempo', typeof call.body.collectedAt === 'string' && call.body.collectedAt !== '');

  check('sem aviso de parcial', summary.hasMore === false);
  check('o resumo declara a paginação', summary.pages === 2 && summary.stopReason === 'complete', `${summary.pages}/${summary.stopReason}`);

  const run = state.local.lastSubscriptionsRun;
  check(
    'o resumo ficou no storage do popup',
    run && run.ok === true && run.channelCount === 2 && run.pages === 2,
    JSON.stringify(run),
  );
}

process.stdout.write('a contagem exibida é a que a ponte confirmou — o dado:\n');
{
  const state = fakeChrome();
  // A ponte é quem decide o que existe no retrato: se ela gravar menos do que
  // recebeu, a UI mostra o que foi gravado, não o que a extração declarou.
  state.bridgeBody = { stored: 1 };
  const summary = await collectSubscriptions('manual');

  check('a coleta deu certo', summary.ok === true, String(summary.error ?? summary.delivery));
  check(
    'a contagem vem do que a ponte gravou, não da extração',
    summary.channelCount === 1,
    String(summary.channelCount),
  );
  check(
    'os dois canais foram entregues mesmo assim',
    state.fetchCalls[0].body.channels.length === 2,
    String(state.fetchCalls[0].body.channels.length),
  );
  check(
    'o resumo guardado usa a mesma contagem',
    state.local.lastSubscriptionsRun.channelCount === 1,
    JSON.stringify(state.local.lastSubscriptionsRun),
  );
}

process.stdout.write('sem confirmação da ponte, vale a contagem extraída:\n');
{
  const state = fakeChrome();
  state.bridgeBody = {};
  const summary = await collectSubscriptions('manual');

  check('a coleta deu certo', summary.ok === true, String(summary.error ?? summary.delivery));
  check('a contagem cai na extração', summary.channelCount === 2, String(summary.channelCount));
}

process.stdout.write('o censo estrutural fica legível no storage local:\n');
{
  const state = fakeChrome();
  state.scriptResult = {
    ok: true,
    channels: CHANNELS,
    hasMore: true,
    pages: 1,
    stopReason: 'stale-continuation',
    diagnostics: {
      snapshot: {
        label: 'retrato',
        top: ['contents', 'header'],
        channelsSeen: 2,
        firstChannelPath: '.contents.x.gridRenderer.items[0]',
        continuationKeys: [],
        tokenKeys: [{ k: 'nextPageToken', p: '.contents.x.pagination.nextPageToken', t: 'str(64) TOKEN…' }],
      },
      bootstrap: null,
      pages: [],
    },
  };
  await collectSubscriptions('manual');

  const diag = state.local.lastSubscriptionsDiagnostics;
  check(
    'o censo do retrato ficou no storage',
    diag && diag.diagnostics.snapshot.tokenKeys.length === 1,
    JSON.stringify(diag && diag.diagnostics && diag.diagnostics.snapshot.tokenKeys),
  );
  check('com a versão da extensão', typeof (diag && diag.version) === 'string' && diag.version !== '', String(diag && diag.version));
  check('com o desfecho da rodada', diag && diag.stopReason === 'stale-continuation' && diag.pages === 1);
  check('e entregue normal mesmo com censo', state.fetchCalls.length === 1 && state.fetchCalls[0].url === BRIDGE_URL);
}

process.stdout.write('duas chamadas concorrentes compartilham a rodada:\n');
{
  const state = fakeChrome();
  let release = null;
  state.scriptGate = new Promise((resolve) => {
    release = resolve;
  });

  const first = collectSubscriptions('manual');
  const second = collectSubscriptions('manual');
  release();
  const [a, b] = await Promise.all([first, second]);

  check('uma única aba foi aberta', state.calls.create.length === 1, `abriu ${state.calls.create.length}`);
  check('as duas chamadas viram o mesmo resultado', a === b);
}

process.stdout.write('falha na extração ainda fecha a aba:\n');
{
  const state = fakeChrome();
  state.scriptError = 'executeScript falhou';
  const summary = await collectSubscriptions('manual');

  check('a coleta falhou', summary.ok === false);
  check('com o motivo declarado', String(summary.error ?? '').includes('executeScript'), String(summary.error));
  check('nenhuma aba ficou para trás', state.tabs.size === 1 && state.tabs.has(USER_TAB_ID));
  check('posse limpa', state.session.ownedSubscriptionsTabId === undefined);
  check('nada foi entregue', state.fetchCalls.length === 0);
}

process.stdout.write('lista vazia falha sem entregar:\n');
{
  const state = fakeChrome();
  state.scriptResult = { ok: true, channels: [], hasMore: false };
  const summary = await collectSubscriptions('manual');

  check('a coleta falhou', summary.ok === false);
  check('com motivo de lista vazia', String(summary.error ?? '').includes('inscrição'), String(summary.error));
  check('não mandou um vazio para a ponte', state.fetchCalls.length === 0);
  check('a aba foi fechada', !state.tabs.has(state.calls.create[0].id));
}

process.stdout.write('ponte fora do ar não deixa aba para trás:\n');
{
  const state = fakeChrome();
  state.fetchError = 'fetch failed';
  const summary = await collectSubscriptions('manual');

  check('a coleta falhou', summary.ok === false);
  check('com o motivo da entrega', String(summary.delivery ?? '').includes('fetch failed'), String(summary.delivery));
  check('a aba foi fechada mesmo assim', !state.tabs.has(state.calls.create[0].id));
  check('posse limpa', state.session.ownedSubscriptionsTabId === undefined);
}

process.stdout.write('aba deixada por uma coleta interrompida é reaproveitada e fechada:\n');
{
  const state = fakeChrome();
  const leakedId = 42;
  state.tabs.set(leakedId, {
    id: leakedId,
    url: 'https://www.youtube.com/watch?v=antigo',
    status: 'complete',
    windowId: 1,
  });
  state.session.ownedSubscriptionsTabId = leakedId;

  const summary = await collectSubscriptions('manual');

  check('reaproveitou a aba própria', summary.reusedTab === true, String(summary.reusedTab));
  check('não abriu aba nova', state.calls.create.length === 0);
  check('navegou a aba própria para as inscrições', state.calls.update.some((call) => call.tabId === leakedId));
  check('extraiu depois da navegação', state.calls.script[0].url === SUBS_URL, String(state.calls.script[0]?.url));
  check('fechou a aba que ficou', state.calls.remove.includes(leakedId) && !state.tabs.has(leakedId));
  check('posse limpa', state.session.ownedSubscriptionsTabId === undefined);
}

process.stdout.write(failures === 0 ? '\nTUDO OK\n' : `\n${failures} FALHA(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
