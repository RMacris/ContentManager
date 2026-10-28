/**
 * Service worker da extensão — o ponto de entrada.
 *
 * Duas responsabilidades, ambas locais: o bloqueio de URLs e os interruptores
 * do filtro do feed. Nenhuma chamada de rede, nenhum servidor — a extensão
 * carrega no Chrome e funciona sozinha.
 */
import { addBlockRule, initializeRules, removeBlockRule } from './blocking.js';
import { getSettings, saveSettings } from './settings.js';

chrome.runtime.onInstalled.addListener(() => {
  void initializeRules();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeRules();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true; // mantém o canal aberto para a resposta assíncrona
});

async function handleMessage(message) {
  switch (message && message.action) {
    case 'addBlockRule':
      return addBlockRule(message.url);
    case 'removeBlockRule':
      return removeBlockRule(message.ruleId);

    case 'status':
      return { action: 'status', settings: await getSettings() };

    case 'saveSettings':
      await saveSettings(message.patch ?? {});
      return { action: 'saveSettings', ok: true, settings: await getSettings() };

    default:
      return { action: 'error', message: 'ação desconhecida' };
  }
}
