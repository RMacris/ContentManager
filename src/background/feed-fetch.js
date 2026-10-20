/**
 * A colheita sem aba: o feed é buscado daqui, com a sessão do usuário.
 *
 * O service worker busca o HTML da home — os cookies vão junto (`credentials:
 * 'include'`) — e lê o `ytInitialData` embutido, o mesmo JSON que a página usa.
 * Não abre aba, não navega e não fecha nada: a rota foi medida contra a rota por
 * aba e devolveu a mesma faixa de cards. Tudo que não for uma colheita de
 * verdade falha alto, com motivo — feed vazio nunca passa por sucesso.
 */
import { extractFeedCards, parseInitialDataFromHtml } from '../injected/feed-extract.js';
import { getSettings } from './settings.js';

const FEED_URL = 'https://www.youtube.com/';

/**
 * O carimbo de build vem do próprio HTML: no worker não existe `window.ytcfg`
 * (a página é que o expõe), mas o `ytcfg` embutido traz `PAGE_BUILD_LABEL`.
 */
export function parseBuildLabelFromHtml(html) {
  if (typeof html !== 'string') return null;
  const match = /"PAGE_BUILD_LABEL"\s*:\s*"([^"]+)"/.exec(html);
  return match ? match[1] : null;
}

/**
 * Busca a home, extrai o topo do feed e devolve `{ cards, buildLabel }`.
 *
 * Falha com `Error` — e mensagem em português — quando a home não responde, não
 * traz o `ytInitialData` (página de login/consentimento, por exemplo) ou não
 * produz card nenhum. Quem chama trata a falha; nunca há colheita vazia.
 */
export async function collectFeed() {
  let response;
  try {
    response = await fetch(FEED_URL, {
      credentials: 'include',
      headers: { 'accept-language': navigator.language || 'pt-BR' },
    });
  } catch (error) {
    throw new Error(`busca do feed falhou: ${String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`busca do feed falhou: HTTP ${response.status}`);
  }

  const html = await response.text();
  const data = parseInitialDataFromHtml(html);
  if (data === null) {
    // Sem o JSON, o que veio foi quase certamente a página de login/consentimento.
    throw new Error('sem ytInitialData na home — provavelmente login ou consentimento pendente');
  }

  const { maxCards } = await getSettings();
  const extracted = extractFeedCards(maxCards, data);
  if (extracted.ok !== true) {
    throw new Error(`extração falhou: ${extracted.reason || 'sem resultado'}`);
  }
  if (extracted.cards.length === 0) {
    throw new Error('nenhum card encontrado — o layout do YouTube pode ter mudado');
  }

  return { cards: extracted.cards, buildLabel: parseBuildLabelFromHtml(html) };
}
