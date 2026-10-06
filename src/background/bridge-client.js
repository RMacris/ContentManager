/**
 * Cliente da ponte: entrega a colheita por HTTP.
 *
 * Se a ponte estiver fora do ar (harness fechado, por exemplo), o lote vai para
 * uma fila em `storage.local` e é reenviado na próxima oportunidade. A fila tem
 * teto: passando dele, os lotes mais velhos são descartados — o feed de hoje vale
 * mais que o de anteontem.
 */
import { getSettings, MAX_PENDING_HARVESTS } from './settings.js';

const QUEUE_KEY = 'pendingHarvests';
const STATUS_KEY = 'lastDelivery';

function baseUrl(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

/** Uma tentativa de entrega. Nunca lança: devolve o resultado. */
export async function sendHarvest(harvest) {
  const { bridgeUrl, bridgeToken } = await getSettings();

  if (bridgeToken === '') {
    return { ok: false, status: 0, detail: 'token não configurado no popup' };
  }

  try {
    const response = await fetch(`${baseUrl(bridgeUrl)}/harvest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yti-token': bridgeToken },
      body: JSON.stringify(harvest),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, status: response.status, detail: detail.slice(0, 200) };
    }

    const body = await response.json().catch(() => ({}));
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, detail: String(error).slice(0, 200) };
  }
}

/** Guarda um lote para reenviar depois, respeitando o teto da fila. */
export async function queueHarvest(harvest) {
  const stored = await chrome.storage.local.get({ [QUEUE_KEY]: [] });
  const queue = stored[QUEUE_KEY];
  queue.push(harvest);
  while (queue.length > MAX_PENDING_HARVESTS) queue.shift();
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  return queue.length;
}

/**
 * Tenta entregar tudo o que está na fila. Para no primeiro erro: se a ponte está
 * fora, insistir nos outros não adianta.
 */
export async function flushQueue() {
  const stored = await chrome.storage.local.get({ [QUEUE_KEY]: [] });
  const queue = stored[QUEUE_KEY];
  if (queue.length === 0) return { delivered: 0, remaining: 0 };

  let delivered = 0;
  while (queue.length > 0) {
    const next = queue[0];
    const result = await sendHarvest(next);
    if (!result.ok) break;
    queue.shift();
    delivered += 1;
  }

  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  return { delivered, remaining: queue.length };
}

/** Só para o popup dizer se a ponte está de pé. */
export async function pingBridge() {
  const { bridgeUrl } = await getSettings();
  try {
    const response = await fetch(`${baseUrl(bridgeUrl)}/health`, { method: 'GET' });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const body = await response.json().catch(() => ({}));
    return { ok: true, body };
  } catch (error) {
    return { ok: false, detail: String(error).slice(0, 200) };
  }
}

/** O popup lê isto para mostrar o que aconteceu na última colheita. */
export async function recordDelivery(result) {
  await chrome.storage.local.set({
    [STATUS_KEY]: {
      at: new Date().toISOString(),
      ok: result.ok,
      detail: result.ok ? 'entregue' : result.detail,
    },
  });
}

export async function readDelivery() {
  const stored = await chrome.storage.local.get({ [STATUS_KEY]: null, [QUEUE_KEY]: [] });
  return { lastDelivery: stored[STATUS_KEY], queueLength: stored[QUEUE_KEY].length };
}
