/**
 * Configurações da extensão.
 *
 * Duas gavetas de propósito:
 * - `chrome.storage.sync` guarda preferências (URL da ponte, período, ligado/desligado).
 * - `chrome.storage.local` guarda o token e a fila de colheitas pendentes.
 *
 * O token não vai para `sync` porque sincroniza entre máquinas e perfis — um
 * segredo local não deve viajar.
 */

export const DEFAULT_SETTINGS = {
  /** Onde a ponte escuta. */
  bridgeUrl: 'http://127.0.0.1:8791',
  /** Se a colheita periódica está ligada. */
  collectEnabled: true,
  /** Período da colheita, em minutos. Editável no popup. */
  collectPeriodMinutes: 60,
  /** Teto de cards por colheita: só o topo do feed, sem paginar. */
  maxCards: 30,
  /**
   * Maximizar a janela antes de colher (com rolagem de três telas como reserva).
   * Fica ligado porque foi pedido, mas é a parte mais intrusiva da extensão —
   * desligar aqui não afeta a coleta, que lê o JSON da página, não a tela.
   */
  maximizeBeforeCollect: true,
};

export const ALARM_NAME = 'yti-collect';

/** Quantos lotes pendentes guardar quando a ponte está fora do ar. */
export const MAX_PENDING_HARVESTS = 5;

export async function getSettings() {
  const sync = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const local = await chrome.storage.local.get({ bridgeToken: '' });
  return { ...sync, bridgeToken: local.bridgeToken };
}

export async function saveSettings(patch) {
  const { bridgeToken, ...syncPatch } = patch;
  if (Object.keys(syncPatch).length > 0) {
    await chrome.storage.sync.set(syncPatch);
  }
  if (typeof bridgeToken === 'string') {
    await chrome.storage.local.set({ bridgeToken });
  }
}

/** Reagenda o alarme conforme o período atual. Chamado ao instalar e ao salvar. */
export async function rescheduleAlarm() {
  const { collectEnabled, collectPeriodMinutes } = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  if (!collectEnabled) return;
  // `delayInMinutes` evita colher no instante em que o navegador abre.
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: Math.max(1, collectPeriodMinutes),
  });
}
