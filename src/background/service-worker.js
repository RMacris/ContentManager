/**
 * Service worker da extensão — o ponto de entrada.
 *
 * Duas responsabilidades, ambas locais: o bloqueio de URLs e os interruptores
 * do filtro do feed. Nenhuma chamada de rede, nenhum servidor — a extensão
 * carrega no Chrome e funciona sozinha.
 */
import { addBlockRule, getBlockedUrls, initializeRules, removeBlockRule } from './blocking.js';
import { getChannelCatalog, saveChannelCatalog } from './channels.js';
import { injectFilterIntoOpenTabs } from './injection.js';
import { getSettings, initializeKeywordLists, saveSettings } from './settings.js';

chrome.runtime.onInstalled.addListener(() => {
  void reconcileBlockedUrls();
  void initializeKeywordLists();
  void injectFilterIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void reconcileBlockedUrls();
  void injectFilterIntoOpenTabs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.blockedUrls) return;
  return reconcileBlockedUrls();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        action: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível concluir a operação.',
      });
    });
  return true; // mantém o canal aberto para a resposta assíncrona
});

async function handleMessage(message) {
  switch (message && message.action) {
    case 'addBlockRule':
      return addBlockRule(message.url);
    case 'removeBlockRule':
      return removeBlockRule(message.ruleId);

    case 'getBlockedUrls':
      await reconcileBlockedUrls();
      return { action: 'blockedUrls', blockedUrls: await getBlockedUrls() };

    case 'status':
      return { action: 'status', settings: await getSettings() };

    case 'getChannelCatalog':
      return { action: 'channelCatalog', catalog: await getChannelCatalog() };

    case 'saveChannelCatalog': {
      const catalog = await saveChannelCatalog(message.channels);
      return { action: 'saveChannelCatalog', ok: true, count: catalog.channels.length };
    }

    case 'saveSettings':
      await saveSettings(message.patch ?? {});
      // Salvar no popup também revive as abas abertas: se o content script
      // delas morreu (extensão recarregada), a mudança passa a valer na hora.
      await injectFilterIntoOpenTabs();
      return { action: 'saveSettings', ok: true, settings: await getSettings() };

    default:
      return { action: 'error', message: 'ação desconhecida' };
  }
}

function reconcileBlockedUrls() {
  return initializeRules().catch((error) => {
    console.error('Could not synchronize URL-blocking rules with saved settings.', error);
  });
}
