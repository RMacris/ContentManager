/**
 * Sonda de medição (temporária, versão 1.4): a rota sem aba funciona?
 *
 * O service worker busca o HTML do feed **com os cookies da sessão** e extrai o
 * mesmo `ytInitialData` que a página usa. O resultado é gravado em
 * `chrome.storage.local` para inspeção externa — a sonda não participa da
 * colheita. Serve para comparar contra a última colheita por aba: contagem de
 * cards, ids, títulos e tempo. Some quando a decisão for tomada.
 */
import { extractFeedCards, parseInitialDataFromHtml } from '../injected/feed-extract.js';

const PROBE_KEY = 'probeFeedHtml';

export async function probeFeedHtml() {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const response = await fetch('https://www.youtube.com/', {
      credentials: 'include',
      headers: { 'accept-language': navigator.language || 'pt-BR' },
    });
    const html = await response.text();
    const parsed = parseInitialDataFromHtml(html);
    const extracted = parsed ? extractFeedCards(30, parsed) : null;

    await chrome.storage.local.set({
      [PROBE_KEY]: {
        at: startedAt,
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
        bytes: html.length,
        elapsedMs: Date.now() - t0,
        hasInitialData: parsed !== null,
        cardCount: extracted ? extracted.cards.length : null,
        cards: extracted ? extracted.cards : null,
        error: null,
      },
    });
  } catch (error) {
    await chrome.storage.local.set({
      [PROBE_KEY]: { at: startedAt, elapsedMs: Date.now() - t0, error: String(error).slice(0, 300) },
    });
  }
}
