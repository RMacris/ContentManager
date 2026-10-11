/**
 * A coleta das inscrições: aba própria, extração e entrega.
 *
 * Diferente da colheita do feed, que roda no relógio do alarme, esta coleta é
 * **manual**: quem dispara é o botão do popup. Mesmo assim ela abre uma aba
 * própria em segundo plano e a fecha ao fim — a automação não mexe no que é do
 * usuário, e a página visitada é descartável.
 *
 * A lista não tem fila de reenvio: a coleta é manual e uma entrega que falhou se
 * resolve clicando de novo — uma fila de inscrições velhas não serviria para nada.
 */
import { sendSubscriptions } from './bridge-client.js';
import { extractSubscriptions } from '../injected/subscriptions-extract.js';
import { closeOwnedTab, ensureOwnedTab, extractInTab } from './owned-tab.js';
import { getSettings } from './settings.js';

/** A página que lista todas as inscrições — a que a coleta visita. */
export const SUBSCRIPTIONS_URL = 'https://www.youtube.com/feed/channels';

/** Onde a posse da aba própria desta finalidade é registrada. */
const OWNED_TAB_KEY = 'ownedSubscriptionsTabId';

const LAST_RUN_KEY = 'lastSubscriptionsRun';

/** A coleta em andamento, quando há uma — o botão e um clique duplo compartilham a rodada. */
let inFlight = null;

/**
 * Coleta agora. Nunca lança: devolve um resumo, como a colheita do feed — quem
 * chama é o popup, que só tem onde mostrar a linha do resultado.
 */
export function collectSubscriptions(trigger) {
  if (inFlight !== null) return inFlight;
  inFlight = executeCollect(trigger).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function executeCollect(trigger) {
  const startedAt = new Date().toISOString();
  let outcome;

  try {
    const { maxSubscriptions } = await getSettings();
    const { tabId, reused, focus } = await ensureOwnedTab({ url: SUBSCRIPTIONS_URL, key: OWNED_TAB_KEY });

    let extracted = null;
    let failure = null;
    try {
      const payload = await extractInTab(tabId, extractSubscriptions, [maxSubscriptions]);
      if (!payload || payload.ok !== true) {
        throw new Error(`extração falhou: ${(payload && payload.reason) || 'sem resultado'}`);
      }
      extracted = payload;
    } catch (error) {
      failure = error;
    }

    const closing = await closeOwnedTab(tabId, OWNED_TAB_KEY);
    if (failure) throw failure;

    if (extracted.channels.length === 0) {
      // Lista vazia quase sempre é página de login/consentimento ou forma mudada —
      // entregar vazio faria a UI parecer que o usuário não tem inscrição nenhuma.
      outcome = {
        ok: false,
        error: 'nenhuma inscrição encontrada — o Chrome está logado no YouTube?',
        reusedTab: reused,
        tabClosed: closing.closed,
      };
    } else {
      const payload = {
        collectedAt: new Date().toISOString(),
        source: SUBSCRIPTIONS_URL,
        hasMore: extracted.hasMore === true,
        channels: extracted.channels,
      };
      const delivery = await sendSubscriptions(payload);

      outcome = {
        ok: delivery.ok,
        channelCount: extracted.channels.length,
        hasMore: extracted.hasMore === true,
        reusedTab: reused,
        tabClosed: closing.closed,
        delivery: delivery.ok ? 'entregue' : delivery.detail,
        focus,
      };
    }
  } catch (error) {
    outcome = { ok: false, error: String(error) };
  }

  const summary = { at: startedAt, trigger, ...outcome };
  await chrome.storage.local.set({ [LAST_RUN_KEY]: summary });
  return summary;
}

/** O popup lê isto para mostrar o que aconteceu na última coleta de inscrições. */
export async function readLastSubscriptionsRun() {
  const stored = await chrome.storage.local.get({ [LAST_RUN_KEY]: null });
  return stored[LAST_RUN_KEY];
}
