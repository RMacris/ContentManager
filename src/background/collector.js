/**
 * A colheita: orquestra aba, extração e entrega.
 *
 * Roda no relógio da própria extensão (o alarme), nunca por comando de fora —
 * o service worker do MV3 dorme, e nada externo consegue acordá-lo. É por isso
 * que a extensão inicia, em vez de ser comandada.
 */
import { flushQueue, queueHarvest, recordDelivery, sendHarvest } from './bridge-client.js';
import { harvestInOwnTab } from './youtube-tab.js';

const LAST_RUN_KEY = 'lastCollectRun';

/**
 * Colhe agora, seja pelo alarme ou pelo botão do popup.
 * Nunca lança: devolve um resumo, porque quem chama é um alarme sem ninguém olhando.
 */
export async function collectNow(trigger) {
  const startedAt = new Date().toISOString();

  // Antes de colher, tentar entregar o que ficou preso da última vez.
  let flushed = { delivered: 0, remaining: 0 };
  try {
    flushed = await flushQueue();
  } catch (error) {
    // Falha ao esvaziar a fila não impede a colheita de hoje.
  }

  let outcome;
  try {
    // A colheita inteira acontece numa aba própria, fechada ao fim: as abas do
    // usuário não são selecionadas, navegadas nem fechadas.
    const { cards, buildLabel, windowState, reused, tabClosed } = await harvestInOwnTab();

    if (cards.length === 0) {
      outcome = {
        ok: false,
        error: 'nenhum card encontrado — o layout do YouTube pode ter mudado',
        reusedTab: reused,
        tabClosed,
      };
    } else {
      const harvest = {
        collectedAt: new Date().toISOString(),
        source: 'https://www.youtube.com/',
        buildLabel,
        cards,
      };

      const delivery = await sendHarvest(harvest);
      if (!delivery.ok) await queueHarvest(harvest);
      await recordDelivery(delivery);

      outcome = {
        ok: delivery.ok,
        cardCount: cards.length,
        reusedTab: reused,
        tabClosed,
        maximized: windowState.maximized,
        maximizeReason: windowState.reason,
        delivery: delivery.ok ? 'entregue' : delivery.detail,
      };
    }
  } catch (error) {
    outcome = { ok: false, error: String(error) };
  }

  const summary = { at: startedAt, trigger, ...outcome, flushed };
  await chrome.storage.local.set({ [LAST_RUN_KEY]: summary });
  return summary;
}

export async function readLastRun() {
  const stored = await chrome.storage.local.get({ [LAST_RUN_KEY]: null });
  return stored[LAST_RUN_KEY];
}
