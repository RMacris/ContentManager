/**
 * Teste do ciclo de vida da aba da colheita.
 *
 * O que este teste protege é a coreografia com o navegador:
 * - aba do usuário nunca é tocada (nem consultada);
 * - a aba própria abre em segundo plano e fecha ao fim, dê certo ou errado;
 * - uma aba deixada por uma colheita interrompida é reaproveitada e fechada;
 * - se fechar falhar, a posse fica registrada para a rodada seguinte tentar de novo.
 *
 * O `chrome` aqui é um dublê: testa-se a coreografia, não o navegador.
 */
import { closeFeedTab, ensureFeedTab, harvestInOwnTab } from '../src/background/youtube-tab.js';

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

const USER_TAB_ID = 7;
const USER_TAB_URL = 'https://www.youtube.com/watch?v=abc';
const FEED_URL = 'https://www.youtube.com/';

/** Dublê do `chrome` — o mínimo que o módulo usa. */
function fakeChrome() {
  const state = {
    sync: {
      bridgeUrl: 'http://127.0.0.1:8791',
      collectEnabled: true,
      collectPeriodMinutes: 60,
      maxCards: 30,
      // Desligado para o teste não precisar de janela.
      maximizeBeforeCollect: false,
    },
    local: { bridgeToken: '' },
    session: {},
    tabs: new Map(),
    nextTabId: 100,
    calls: { query: 0, create: [], update: [], remove: [] },
    scriptResult: { ok: true, cards: [], buildLabel: 'label' },
    scriptError: null,
    removeError: null,
  };

  // A aba do usuário: aberta, reproduzindo um vídeo, e não pode ser tocada.
  state.tabs.set(USER_TAB_ID, { id: USER_TAB_ID, url: USER_TAB_URL, status: 'complete', windowId: 1 });

  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...state.sync }),
      },
      local: {
        get: async (defaults) => ({ ...defaults, ...state.local }),
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
        if (state.removeError) throw new Error(state.removeError);
        if (!state.tabs.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
        state.tabs.delete(tabId);
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: {
      executeScript: async () => {
        if (state.scriptError) throw new Error(state.scriptError);
        return [{ result: state.scriptResult }];
      },
    },
  };

  return state;
}

process.stdout.write('aba do usuário intocada:\n');
{
  const state = fakeChrome();
  state.scriptResult = { ok: true, cards: [{ videoId: 'v1' }], buildLabel: 'build-1' };
  const result = await harvestInOwnTab();

  check('colheita devolveu os cards', result.cards.length === 1 && result.cards[0].videoId === 'v1');
  check('nunca consultou as abas do navegador', state.calls.query === 0, `consultou ${state.calls.query}x`);
  check('aba do usuário não foi atualizada', state.calls.update.length === 0);
  check('aba do usuário continua na mesma url', state.tabs.get(USER_TAB_ID).url === USER_TAB_URL);
  check(
    'abriu a própria aba em segundo plano',
    state.calls.create.length === 1 &&
      state.calls.create[0].active === false &&
      state.calls.create[0].url === FEED_URL,
  );
  check(
    'fechou a própria aba',
    state.calls.remove.includes(state.calls.create[0].id) && !state.tabs.has(state.calls.create[0].id),
  );
  check('não sobrou posse registrada', state.session.ownedFeedTabId === undefined);
  check('reused é false na primeira rodada', result.reused === false);
  check('tabClosed é true', result.tabClosed === true);
}

process.stdout.write('falha na extração ainda fecha a aba:\n');
{
  const state = fakeChrome();
  state.scriptError = 'executeScript falhou';
  let error = null;
  try {
    await harvestInOwnTab();
  } catch (caught) {
    error = caught;
  }

  check('erro propagado', error !== null && String(error).includes('executeScript'));
  check('nenhuma aba ficou para trás', state.tabs.size === 1 && state.tabs.has(USER_TAB_ID));
  check('posse limpa', state.session.ownedFeedTabId === undefined);
}

process.stdout.write('aba deixada por uma colheita interrompida:\n');
{
  const state = fakeChrome();
  const leakedId = 42;
  state.tabs.set(leakedId, { id: leakedId, url: FEED_URL, status: 'complete', windowId: 1 });
  state.session.ownedFeedTabId = leakedId;
  state.scriptResult = { ok: true, cards: [{ videoId: 'v2' }], buildLabel: 'build-1' };

  const result = await harvestInOwnTab();
  check('reaproveitou a aba própria', result.reused === true);
  check('não abriu aba nova', state.calls.create.length === 0);
  check('navegou a aba própria de volta ao feed', state.calls.update.some((c) => c.tabId === leakedId));
  check('fechou a aba que ficou', state.calls.remove.includes(leakedId) && !state.tabs.has(leakedId));
  check('posse limpa', state.session.ownedFeedTabId === undefined);
}

process.stdout.write('posse apontando para aba que já não existe:\n');
{
  const state = fakeChrome();
  state.session.ownedFeedTabId = 999;
  const result = await ensureFeedTab();

  check('abriu uma aba nova', state.calls.create.length === 1 && state.calls.create[0].id === result.tabId);
  check('posse aponta para a aba nova', state.session.ownedFeedTabId === result.tabId);

  await closeFeedTab(result.tabId);
  check('fechar limpa a posse', state.session.ownedFeedTabId === undefined && !state.tabs.has(result.tabId));
}

process.stdout.write('falha ao fechar mantém a posse para a próxima rodada:\n');
{
  const state = fakeChrome();
  state.scriptResult = { ok: true, cards: [{ videoId: 'v3' }], buildLabel: 'build-1' };
  state.removeError = 'Tabs cannot be edited right now (user may be dragging a tab)';
  const result = await harvestInOwnTab();
  const createdId = state.calls.create[0].id;

  check('a colheita devolveu os cards mesmo assim', result.cards.length === 1);
  check('tabClosed é false', result.tabClosed === false);
  check('a aba continua de pé', state.tabs.has(createdId));
  check('a posse continua registrada', state.session.ownedFeedTabId === createdId);
}

process.stdout.write('fechar aba que já não existe é sucesso:\n');
{
  fakeChrome();
  const closing = await closeFeedTab(555);
  check('closed true para aba ausente', closing.closed === true && closing.alreadyGone === true);
}

process.stdout.write(failures === 0 ? '\nTUDO OK\n' : `\n${failures} FALHA(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
