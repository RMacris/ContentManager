/**
 * Aba do YouTube e janela: abrir, colher, fechar.
 *
 * Princípio que governa este arquivo: **a automação não mexe no que é do usuário.**
 * A colheita usa uma aba própria, aberta em segundo plano e fechada ao fim — aba
 * que o usuário abriu nunca é selecionada, navegada nem fechada. Era a navegação
 * dessa aba que fazia um vídeo em reprodução pular para a home a cada ciclo.
 *
 * Se o worker morrer no meio de uma colheita, a aba fica; o id dela é guardado em
 * `chrome.storage.session`, e a rodada seguinte reaproveita e fecha essa aba, em
 * vez de acumular outra.
 */
import { extractFeedCards, scrollThreeViewports } from '../injected/feed-extract.js';
import { getSettings } from './settings.js';

const FEED_URL = 'https://www.youtube.com/';

/** Onde a posse da aba própria é registrada, para sobreviver a um worker morto. */
const OWNED_TAB_KEY = 'ownedFeedTabId';

/**
 * Espera a aba terminar de carregar, com teto de tempo.
 *
 * `expectedUrl` é o critério de aceitação: uma aba marcada como completa na
 * página antiga (a corrida da aba reaproveitada) não conta. Em `ignoreInitial`,
 * nem o estado inicial vale — só um evento de `complete` da navegação nova,
 * porque a carga que nos interessa é a que a chamada de `update` disparou.
 */
function waitForComplete(tabId, expectedUrl, ignoreInitial = false, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    };

    const listener = (changedId, info) => {
      if (changedId !== tabId || info.status !== 'complete') return;
      // Confere a URL de novo: redirect para consentimento/login não é o feed.
      chrome.tabs.get(changedId).then(
        (tab) => {
          if (tab && tab.url === expectedUrl) finish(true);
        },
        () => {},
      );
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);

    // A aba pode já estar completa quando chegamos aqui — mas só vale se for a
    // página que esperamos, e nunca no caso de navegação recém Disparada.
    if (!ignoreInitial) {
      chrome.tabs.get(tabId).then(
        (tab) => {
          if (tab.status === 'complete' && tab.url === expectedUrl) finish(true);
        },
        () => finish(false),
      );
    }
  });
}

/** O id da aba própria, registrado para o caso de uma colheita interrompida no meio. */
async function readOwnedTabId() {
  const stored = await chrome.storage.session.get({ [OWNED_TAB_KEY]: null });
  return stored[OWNED_TAB_KEY];
}

async function rememberOwnedTab(tabId) {
  await chrome.storage.session.set({ [OWNED_TAB_KEY]: tabId });
}

async function forgetOwnedTab(tabId) {
  const stored = await readOwnedTabId();
  if (stored === tabId) await chrome.storage.session.remove(OWNED_TAB_KEY);
}

/** Lê a aba sem lançar: null quando ela já não existe. */
async function getTabOrNull(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/**
 * Diagnóstico de foco: mede se criar/navegar a aba própria mexe na janela.
 * A aba nasce com `active:false`; o registro prova — ou desmente — que ela não
 * veio para primeiro plano. Nunca lança: API indisponível vira `null`.
 */
async function focusBefore() {
  try {
    const win = await chrome.windows.getLastFocused();
    return {
      windowId: typeof win.id === 'number' ? win.id : null,
      focused: typeof win.focused === 'boolean' ? win.focused : null,
    };
  } catch {
    return { windowId: null, focused: null };
  }
}

async function focusAfter(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const win = await chrome.windows.get(tab.windowId);
    return {
      tabActive: tab.active === true,
      windowFocused: typeof win.focused === 'boolean' ? win.focused : null,
    };
  } catch {
    return { tabActive: null, windowFocused: null };
  }
}

/**
 * Devolve a aba própria da colheita: reaproveita a que ficou de uma rodada
 * interrompida, senão abre uma nova **em segundo plano** — abrir em primeiro
 * plano arrancaria o usuário do que ele está fazendo. Aba do usuário não entra
 * na conta: a extensão não navega nem colhe naquilo que ela não abriu.
 */
export async function ensureFeedTab() {
  const ownedId = await readOwnedTabId();
  if (typeof ownedId === 'number') {
    const owned = await getTabOrNull(ownedId);
    if (owned) {
      const before = await focusBefore();
      await chrome.tabs.update(ownedId, { url: FEED_URL });
      const after = await focusAfter(ownedId);
      // Navegação recém-disparada: a página antiga ainda se diz completa, então
      // só um `complete` da navegação nova vale.
      await waitForComplete(ownedId, FEED_URL, true);
      return { tabId: ownedId, reused: true, focus: { before, after } };
    }
    await forgetOwnedTab(ownedId);
  }

  const before = await focusBefore();
  const created = await chrome.tabs.create({ url: FEED_URL, active: false });
  if (typeof created.id !== 'number') {
    throw new Error('não foi possível abrir a aba do YouTube');
  }
  const after = await focusAfter(created.id);
  await rememberOwnedTab(created.id);
  await waitForComplete(created.id, FEED_URL);
  return { tabId: created.id, reused: false, focus: { before, after } };
}

/**
 * Garante a janela maximizada. Se não der, rola três telas como reserva.
 *
 * Maximizar não exige permissão nenhuma, mas a documentação do Chrome não
 * descreve modo de falha — então a confirmação é feita lendo o estado de volta,
 * e tratando `undefined` como falha.
 */
export async function ensureMaximized(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;

  let before;
  try {
    before = await chrome.windows.get(windowId);
  } catch {
    return { maximized: false, reason: 'janela inacessível' };
  }

  if (before.state === 'maximized' || before.state === 'fullscreen') {
    return { maximized: true, reason: 'já estava maximizada' };
  }

  try {
    const after = await chrome.windows.update(windowId, { state: 'maximized' });
    if (after && after.state === 'maximized') {
      return { maximized: true, reason: 'maximizada agora' };
    }
    return { maximized: false, reason: `estado devolvido: ${String(after && after.state)}` };
  } catch (error) {
    return { maximized: false, reason: String(error) };
  }
}

/** Rola três telas na aba — a reserva quando maximizar não é possível. */
export async function scrollFallback(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: scrollThreeViewports,
  });
  return results[0] ? results[0].result : null;
}

/**
 * Colhe os cards da aba. A injeção é no mundo MAIN porque o `ytInitialData` vive
 * no escopo da página — um script de conteúdo comum roda isolado e não o enxerga.
 */
export async function harvestFromTab(tabId) {
  const { maxCards, maximizeBeforeCollect } = await getSettings();

  let windowState = { maximized: false, reason: 'não tentado' };
  if (maximizeBeforeCollect) {
    windowState = await ensureMaximized(tabId);
    if (!windowState.maximized) {
      await scrollFallback(tabId);
    }
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: extractFeedCards,
    args: [maxCards],
  });

  const payload = results[0] ? results[0].result : null;
  if (!payload || payload.ok !== true) {
    throw new Error(`extração falhou: ${(payload && payload.reason) || 'sem resultado'}`);
  }

  return {
    cards: payload.cards,
    buildLabel: payload.buildLabel,
    windowState,
  };
}

/**
 * Fecha a aba própria. "Já não existe" é sucesso; falha de verdade devolve
 * `closed: false` **e mantém a posse**, para a próxima rodada tentar de novo em
 * vez de deixar a aba órfã para sempre.
 */
export async function closeFeedTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
    await forgetOwnedTab(tabId);
    return { closed: true };
  } catch (error) {
    if (await getTabOrNull(tabId)) {
      return { closed: false, reason: String(error).slice(0, 200) };
    }
    await forgetOwnedTab(tabId);
    return { closed: true, alreadyGone: true };
  }
}

/**
 * A colheita inteira numa aba própria e descartável: garante a aba, extrai e
 * fecha — com sucesso ou com falha. É o único caminho de colheita; quem chama
 * `harvestFromTab` direto não fecha nada.
 */
export async function harvestInOwnTab() {
  const { tabId, reused, focus } = await ensureFeedTab();

  let harvest = null;
  let failure = null;
  try {
    harvest = await harvestFromTab(tabId);
  } catch (error) {
    failure = error;
  }

  const closing = await closeFeedTab(tabId);
  if (failure) throw failure;
  return { ...harvest, reused, tabClosed: closing.closed, focus };
}
