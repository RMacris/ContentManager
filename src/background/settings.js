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
  /**
   * Esconder no site do YouTube os cards de vídeo com mais de 3 dias (4 dias
   * ou mais). Vale só para a página; a colheita continua lendo o feed inteiro.
   */
  hideOldVideos: true,
  /** Teto de cards por colheita: só o topo do feed, sem paginar. */
  maxCards: 30,
  /**
   * Teto de canais por coleta de inscrições. A coleta segue as continuações da
   * página até o fim (o `ytInitialData` traz só a primeira leva); o teto só
   * protege contra uma página patológica.
   */
  maxSubscriptions: 1000,
};

export const ALARM_NAME = 'yti-collect';

/** Alarme da retentativa: uma colheita que falhou não espera a hora cheia. */
export const RETRY_ALARM_NAME = 'yti-collect-retry';

/** Espera, em minutos, antes de retentar uma colheita que falhou. */
export const RETRY_DELAY_MINUTES = 5;

/** Teto de retentativas automáticas por episódio de falha. */
export const MAX_RETRIES = 2;

/** Onde o episódio de retentativa guarda as tentativas já gastas. */
export const RETRY_COUNT_KEY = 'collectRetryCount';

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
  if (!collectEnabled) {
    // Desligar a colheita também desliga a retentativa pendente.
    await chrome.alarms.clear(RETRY_ALARM_NAME);
    return;
  }
  // `delayInMinutes` evita colher no instante em que o navegador abre.
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: Math.max(1, collectPeriodMinutes),
  });
}
