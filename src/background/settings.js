/**
 * Configurações da extensão.
 *
 * A extensão é autônoma: nada daqui sai da máquina. As duas preferências que
 * restam valem para o site do YouTube e moram em `chrome.storage.sync`, porque
 * são escolhas do usuário que acompanham o perfil.
 */

export const DEFAULT_SETTINGS = {
  /**
   * Esconder no site do YouTube os cards de vídeo com mais de 3 dias (4 dias
   * ou mais).
   */
  hideOldVideos: true,
  /**
   * Esconder os cards que não têm data para julgar: o jogo da prateleira de
   * playables e o anúncio no feed.
   */
  hideGamesAndAds: true,
};

export async function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

export async function saveSettings(patch) {
  if (Object.keys(patch).length > 0) await chrome.storage.sync.set(patch);
}
