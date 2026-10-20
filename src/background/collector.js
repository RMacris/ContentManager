/**
 * A colheita: orquestra a busca do feed, a extração e a entrega.
 *
 * Roda no relógio da própria extensão (o alarme), nunca por comando de fora —
 * o service worker do MV3 dorme, e nada externo consegue acordá-lo. É por isso
 * que a extensão inicia, em vez de ser comandada.
 */
import { flushQueue, queueHarvest, recordDelivery, sendHarvest } from './bridge-client.js';
import { flushPending, refreshBadge } from './delivery-health.js';
import { collectFeed } from './feed-fetch.js';
import {
  MAX_RETRIES,
  RETRY_ALARM_NAME,
  RETRY_COUNT_KEY,
  RETRY_DELAY_MINUTES,
} from './settings.js';

const LAST_RUN_KEY = 'lastCollectRun';

/**
 * O modo do episódio de retentativa: a rodada inteira (`harvest`) ou só o
 * esvaziamento da fila (`delivery`). Mora aqui, não em `settings.js`, porque é
 * estado da execução, não preferência do usuário.
 */
export const RETRY_MODE_KEY = 'collectRetryMode';
export const RETRY_MODE_HARVEST = 'harvest';
export const RETRY_MODE_DELIVERY = 'delivery';

/**
 * A colheita em andamento, quando há uma. O worker é um só: se o alarme e o
 * botão dispararem juntos, os dois compartilham a mesma rodada em vez de buscar
 * o feed duas vezes e duplicar a entrega.
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
  let flushed = { delivered: 0, remaining: 0, delivery: null };
  try {
    flushed = await flushQueue();
    // Um flush que entrega é a ponte de volta: registra para o popup parar de
    // dizer que ela está fora e, se o episódio pendente era só de entrega,
    // encerra-o. O de colheita mantém a contagem — o teto é compartilhado.
    if (flushed.delivery && flushed.delivery.ok) {
      await recordDelivery(flushed.delivery);
      if ((await readRetryMode()) === RETRY_MODE_DELIVERY) await clearRetryState();
    }
  } catch (error) {
    // Falha ao esvaziar a fila não impede a colheita de hoje.
  }

  let outcome;
  try {
    // O feed vem do HTML da home, buscado daqui com a sessão do usuário:
    // nenhuma aba é aberta, navegada ou fechada.
    const { cards, buildLabel } = await collectFeed();

    if (cards.length === 0) {
      outcome = {
        ok: false,
        harvestOk: false,
        deliveryOk: false,
        deliveryKind: null,
        error: 'nenhum card encontrado — o layout do YouTube pode ter mudado',
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
        harvestOk: true,
        deliveryOk: delivery.ok,
        deliveryKind: delivery.kind,
        cardCount: cards.length,
        delivery: delivery.ok ? 'entregue' : delivery.detail,
      };
    }
  } catch (error) {
    outcome = {
      ok: false,
      harvestOk: false,
      deliveryOk: false,
      deliveryKind: null,
      error: String(error),
    };
  }

  const summary = {
    at: startedAt,
    trigger,
    ...outcome,
    flushed: { delivered: flushed.delivered, remaining: flushed.remaining },
  };
  await chrome.storage.local.set({ [LAST_RUN_KEY]: summary });
  await handleRetry(summary);
  await refreshBadge();
  return summary;
}

/**
 * A retentativa de entrega: esvazia a fila, sem colher.
 *
 * Recolher para tentar entregar de novo empurraria mais um lote para uma fila
 * cheia, expulsando o que ainda não chegou. Quando a ponte volta, é aqui que os
 * pendentes saem — e o resultado fica registrado.
 */
export function retryPending() {
  if (inFlight !== null) return inFlight;
  inFlight = executeRetryPending().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function executeRetryPending() {
  const startedAt = new Date().toISOString();
  let flushed = { delivered: 0, queueLength: 0, delivery: null };
  let error = null;
  try {
    flushed = await flushPending();
  } catch (failure) {
    error = String(failure);
  }

  const delivery = flushed.delivery;
  const deliveryOk = error === null && (delivery === null || delivery.ok === true);
  const summary = {
    at: startedAt,
    trigger: 'retentativa',
    ok: deliveryOk,
    // A rodada não colheu: a colheita não é o que falhou.
    harvestOk: true,
    deliveryRetry: true,
    deliveryOk,
    deliveryKind: delivery ? delivery.kind : null,
    delivery: delivery ? (delivery.ok ? 'entregue' : delivery.detail) : 'nada pendente',
    flushed: { delivered: flushed.delivered, remaining: flushed.queueLength },
  };
  if (error !== null) {
    summary.delivery = `falha ao esvaziar a fila: ${error.slice(0, 200)}`;
    summary.error = summary.delivery;
  }
  await chrome.storage.local.set({ [LAST_RUN_KEY]: summary });
  await handleRetry(summary);
  return summary;
}

/** O modo gravado do episódio; o alarme de retentativa o lê para saber o que repetir. */
export async function readRetryMode() {
  const stored = await chrome.storage.local.get({ [RETRY_MODE_KEY]: RETRY_MODE_HARVEST });
  return stored[RETRY_MODE_KEY];
}

/** Encerra o episódio: sem alarme, sem contagem e sem modo guardado. */
async function clearRetryState() {
  await chrome.alarms.clear(RETRY_ALARM_NAME);
  await chrome.storage.local.remove(RETRY_COUNT_KEY);
  await chrome.storage.local.remove(RETRY_MODE_KEY);
}

/**
 * Retentativa: falha transitória (busca, carga ou ponte fora do ar) não espera a
 * hora cheia. Um sucesso encerra o episódio; cada falha agenda no máximo
 * `MAX_RETRIES` retentativas, e o modo guardado diz se a próxima colhe ou só
 * reenvia. O alarme e o botão começam episódio novo; a própria retentativa
 * apenas continua contando.
 */
async function handleRetry(summary) {
  try {
    if (summary.ok) {
      await clearRetryState();
      return;
    }
    if (summary.trigger !== 'retentativa') {
      await chrome.storage.local.remove(RETRY_COUNT_KEY);
    }
    const stored = await chrome.storage.local.get({ [RETRY_COUNT_KEY]: 0 });
    const used = stored[RETRY_COUNT_KEY];
    if (used >= MAX_RETRIES) return;
    await chrome.alarms.create(RETRY_ALARM_NAME, { delayInMinutes: RETRY_DELAY_MINUTES });
    await chrome.storage.local.set({
      [RETRY_COUNT_KEY]: used + 1,
      [RETRY_MODE_KEY]:
        summary.harvestOk === false ? RETRY_MODE_HARVEST : RETRY_MODE_DELIVERY,
    });
  } catch (error) {
    // Melhor esforço: não conseguir reagendar não pode derrubar a colheita.
  }
}

export async function readLastRun() {
  const stored = await chrome.storage.local.get({ [LAST_RUN_KEY]: null });
  return stored[LAST_RUN_KEY];
}
