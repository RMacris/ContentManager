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

/** Prazo padrão de uma chamada: conexão que não recusa não pode prender o worker. */
const DEFAULT_TIMEOUT_MS = 5000;

function baseUrl(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

/** A espera curta, como o popup a lê: 5000 → "5 s"; 10 → "10 ms". */
function waitLabel(timeoutMs) {
  return timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`;
}

function missingToken() {
  return { ok: false, status: 0, kind: 'missing-token', detail: 'token não configurado no popup' };
}

/** A frase da recusa HTTP — 401 tem significado próprio; o resto leva o trecho do corpo. */
async function rejected(response) {
  if (response.status === 401) {
    return { ok: false, status: 401, kind: 'unauthorized', detail: 'token recusado pela ponte' };
  }
  const excerpt = (await response.text().catch(() => '')).trim().slice(0, 120);
  return {
    ok: false,
    status: response.status,
    kind: 'rejected',
    detail: `a ponte recusou (HTTP ${response.status})${excerpt === '' ? '' : `: ${excerpt}`}`,
  };
}

/**
 * Uma chamada à ponte com prazo. O `AbortController` fecha a conexão que não
 * recusa (firewall, máquina dormindo) no tempo combinado. Nunca lança: devolve
 * o resultado classificado — `offline`, `timeout`, `unauthorized`, `rejected`
 * ou `ok` — com uma frase em português para o popup.
 */
async function request(url, init, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return await rejected(response);
    const body = await response.json().catch(() => ({}));
    return { ok: true, status: response.status, kind: 'ok', body };
  } catch (error) {
    if (timedOut) {
      return {
        ok: false,
        status: 0,
        kind: 'timeout',
        detail: `a ponte não respondeu em ${waitLabel(timeoutMs)}`,
      };
    }
    return { ok: false, status: 0, kind: 'offline', detail: 'sem conexão com a ponte' };
  } finally {
    clearTimeout(timer);
  }
}

/** Uma tentativa de entrega. Nunca lança: devolve o resultado. */
export async function sendHarvest(harvest, options = {}) {
  const { bridgeUrl, bridgeToken } = await getSettings();

  if (bridgeToken === '') return missingToken();

  return request(
    `${baseUrl(bridgeUrl)}/harvest`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yti-token': bridgeToken },
      body: JSON.stringify(harvest),
    },
    options,
  );
}

/**
 * A entrega das inscrições — caminho próprio, sem fila de reenvio: a coleta é
 * manual e uma falha se resolve clicando de novo. Mesmo contrato do `/harvest`:
 * uma tentativa, nunca lança, devolve o resultado.
 */
export async function sendSubscriptions(subscriptions, options = {}) {
  const { bridgeUrl, bridgeToken } = await getSettings();

  if (bridgeToken === '') return missingToken();

  return request(
    `${baseUrl(bridgeUrl)}/subscriptions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yti-token': bridgeToken },
      body: JSON.stringify(subscriptions),
    },
    options,
  );
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
 * Tenta entregar tudo o que está na fila, do mais velho ao mais novo. Para no
 * primeiro erro: se a ponte está fora, insistir nos outros não adianta. O
 * último resultado vai junto — quem reenvia registra a saúde da entrega por ele.
 */
export async function flushQueue() {
  const stored = await chrome.storage.local.get({ [QUEUE_KEY]: [] });
  const queue = stored[QUEUE_KEY];
  if (queue.length === 0) return { delivered: 0, remaining: 0, delivery: null };

  let delivered = 0;
  let delivery = null;
  while (queue.length > 0) {
    delivery = await sendHarvest(queue[0]);
    if (!delivery.ok) break;
    queue.shift();
    delivered += 1;
  }

  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  return { delivered, remaining: queue.length, delivery };
}

/** Só para o popup dizer se a ponte está de pé. */
export async function pingBridge(options = {}) {
  const { bridgeUrl } = await getSettings();
  return request(`${baseUrl(bridgeUrl)}/health`, { method: 'GET' }, options);
}

/** O popup lê isto para mostrar o que aconteceu na última entrega. */
export async function recordDelivery(result) {
  await chrome.storage.local.set({
    [STATUS_KEY]: {
      at: new Date().toISOString(),
      ok: result.ok,
      kind: result.kind ?? (result.ok ? 'ok' : null),
      status: result.status ?? 0,
      detail: result.ok ? 'entregue' : result.detail,
    },
  });
}

export async function readDelivery() {
  const stored = await chrome.storage.local.get({ [STATUS_KEY]: null, [QUEUE_KEY]: [] });
  return { lastDelivery: stored[STATUS_KEY], queueLength: stored[QUEUE_KEY].length };
}
