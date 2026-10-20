/**
 * Saúde da entrega: o selo da ação e o reenvio dos lotes pendentes.
 *
 * O selo mostra, sem abrir o popup, quantos lotes esperam pela ponte — e fica
 * vermelho quando a última entrega falhou. O reenvio é o mesmo núcleo da
 * retentativa de entrega: esvaziar a fila, nunca colher de novo.
 */
import { flushQueue, readDelivery, recordDelivery } from './bridge-client.js';

/**
 * Esvazia a fila, registra o resultado da última tentativa e atualiza o selo —
 * o núcleo do `flushNow` e da retentativa de entrega.
 */
export async function flushPending() {
  const { delivered, remaining, delivery } = await flushQueue();
  if (delivery) await recordDelivery(delivery);
  await refreshBadge();
  return { delivery, queueLength: remaining, delivered };
}

/** O selo: o número de lotes pendentes e o vermelho da última entrega que falhou. */
export async function refreshBadge() {
  try {
    const { lastDelivery, queueLength } = await readDelivery();
    await chrome.action.setBadgeText({ text: queueLength > 0 ? String(queueLength) : '' });
    const failed = lastDelivery !== null && lastDelivery.ok === false;
    await chrome.action.setBadgeBackgroundColor({ color: failed ? '#d93025' : '#1e8e3e' });
  } catch (error) {
    // O selo é acessório: não conseguir desenhá-lo não pode derrubar a colheita.
  }
}
