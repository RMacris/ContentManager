/**
 * Aba do YouTube e janela: encontrar, abrir, maximizar.
 *
 * Princípio que governa este arquivo: **a automação não mexe no que é do usuário.**
 * Reaproveita uma aba que já existe em vez de abrir outra, nunca fecha aba que o
 * usuário abriu, e não rouba o foco da janela em que ele está trabalhando.
 */
import { extractFeedCards, scrollThreeViewports } from '../injected/feed-extract.js';
import { getSettings } from './settings.js';

const FEED_URL = 'https://www.youtube.com/';

/** Espera a aba terminar de carregar, com teto de tempo. */
function waitForComplete(tabId, timeoutMs = 20000) {
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
      if (changedId === tabId && info.status === 'complete') finish(true);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);

    // A aba pode já estar completa quando chegamos aqui.
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') finish(true);
      },
      () => finish(false),
    );
  });
}

/**
 * Devolve a aba do feed a usar: reaproveita uma que já esteja aberta no YouTube,
 * senão abre uma nova **em segundo plano** — abrir em primeiro plano arrancaria
 * o usuário do que ele está fazendo.
 */
export async function ensureFeedTab() {
  const existing = await chrome.tabs.query({ url: ['https://www.youtube.com/*'] });
  const usable = existing.find((tab) => typeof tab.id === 'number' && tab.id >= 0);

  if (usable && typeof usable.id === 'number') {
    await chrome.tabs.update(usable.id, { url: FEED_URL });
    await waitForComplete(usable.id);
    return { tabId: usable.id, reused: true };
  }

  const created = await chrome.tabs.create({ url: FEED_URL, active: false });
  if (typeof created.id !== 'number') {
    throw new Error('não foi possível abrir a aba do YouTube');
  }
  await waitForComplete(created.id);
  return { tabId: created.id, reused: false };
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
