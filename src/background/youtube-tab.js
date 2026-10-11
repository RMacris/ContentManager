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
import { closeOwnedTab, ensureOwnedTab, extractInTab } from './owned-tab.js';
import { getSettings } from './settings.js';

const FEED_URL = 'https://www.youtube.com/';

/** Onde a posse da aba própria da colheita é registrada, para sobreviver a um worker morto. */
const OWNED_TAB_KEY = 'ownedFeedTabId';

/**
 * Devolve a aba própria da colheita: reaproveita a que ficou de uma rodada
 * interrompida, senão abre uma nova em segundo plano. A mecânica da aba própria
 * vive em `owned-tab.js`; aqui fica só a finalidade (o feed).
 */
export async function ensureFeedTab() {
  return ensureOwnedTab({ url: FEED_URL, key: OWNED_TAB_KEY });
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

  const payload = await extractInTab(tabId, extractFeedCards, [maxCards]);
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
  return closeOwnedTab(tabId, OWNED_TAB_KEY);
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
