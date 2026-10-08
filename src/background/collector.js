/**
 * A colheita: orquestra aba, extração e entrega.
 *
 * Roda no relógio da própria extensão (o alarme), nunca por comando de fora —
 * o service worker do MV3 dorme, e nada externo consegue acordá-lo. É por isso
 * que a extensão inicia, em vez de ser comandada.
 */
import { flushQueue, queueHarvest, recordDelivery, sendHarvest } from './bridge-client.js';
import {
  MAX_RETRIES,
  RETRY_ALARM_NAME,
  RETRY_COUNT_KEY,
  RETRY_DELAY_MINUTES,
} from './settings.js';
import { harvestInOwnTab } from './youtube-tab.js';

const LAST_RUN_KEY = 'lastCollectRun';

/**
 * A colheita em andamento, quando há uma. O worker é um só: se o alarme e o
 * botão dispararem juntos, os dois compartilham a mesma rodada em vez de abrir
 * duas abas e uma navegar por cima da outra.
 */
let inFlight = null;

/**
 * Colhe agora, seja pelo alarme ou pelo botão do popup.
 * Nunca lança: devolve um resumo, porque quem chama é um alarme sem ninguém olhando.
 */
export function collectNow(trigger) {
  if (inFlight !== null) return inFlight;
  inFlight = executeCollect(trigger).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function executeCollect(trigger) {
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
    const { cards, buildLabel, windowState, reused, tabClosed, focus } = await harvestInOwnTab();

    if (cards.length === 0) {
      outcome = {
        ok: false,
        error: 'nenhum card encontrado — o layout do YouTube pode ter mudado',
        reusedTab: reused,
        tabClosed,
        focus,
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
        focus,
      };
    }
  } catch (error) {
    outcome = { ok: false, error: String(error) };
  }

  const summary = { at: startedAt, trigger, ...outcome, flushed };
  await chrome.storage.local.set({ [LAST_RUN_KEY]: summary });
  await handleRetry(summary);
  return summary;
}

/**
 * Retentativa: falha transitória (aba, carga ou ponte fora do ar) não espera a
 * hora cheia. Um sucesso encerra o episódio; cada falha agenda no máximo
 * `MAX_RETRIES` retentativas. O alarme e o botão começam episódio novo; a
 * própria retentativa apenas continua contando.
 */
async function handleRetry(summary) {
  try {
    if (summary.ok) {
      await chrome.alarms.clear(RETRY_ALARM_NAME);
      await chrome.storage.local.remove(RETRY_COUNT_KEY);
      return;
    }
    if (summary.trigger !== 'retentativa') {
      await chrome.storage.local.remove(RETRY_COUNT_KEY);
    }
    const stored = await chrome.storage.local.get({ [RETRY_COUNT_KEY]: 0 });
    const used = stored[RETRY_COUNT_KEY];
    if (used >= MAX_RETRIES) return;
    await chrome.alarms.create(RETRY_ALARM_NAME, { delayInMinutes: RETRY_DELAY_MINUTES });
    await chrome.storage.local.set({ [RETRY_COUNT_KEY]: used + 1 });
  } catch (error) {
    // Melhor esforço: não conseguir reagendar não pode derrubar a colheita.
  }
}

export async function readLastRun() {
  const stored = await chrome.storage.local.get({ [LAST_RUN_KEY]: null });
  return stored[LAST_RUN_KEY];
}
