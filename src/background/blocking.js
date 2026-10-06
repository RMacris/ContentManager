/**
 * O bloqueio de URLs — a funcionalidade original da extensão, preservada.
 *
 * Mudou de lugar e ganhou uma correção: a versão anterior removia apenas as
 * regras cujos ids ainda existiam na lista nova. Ao remover uma URL do fim da
 * lista, a regra antiga ficava para trás e continuava bloqueando. Aqui as regras
 * dinâmicas existentes são lidas e removidas por inteiro antes de gravar as novas.
 */

const STORAGE_KEY = 'blockedUrls';

export async function initializeRules() {
  const data = await chrome.storage.sync.get({ [STORAGE_KEY]: [] });
  await updateRules(data[STORAGE_KEY]);
}

export async function addBlockRule(urlPattern) {
  const pattern = String(urlPattern ?? '').trim();
  if (!isValidRegex(pattern)) {
    return { action: 'error', message: 'Invalid regex pattern.' };
  }

  const data = await chrome.storage.sync.get({ [STORAGE_KEY]: [] });
  const blockedUrls = data[STORAGE_KEY];
  blockedUrls.push({ urlPattern: pattern, ruleId: generateUniqueId() });
  await chrome.storage.sync.set({ [STORAGE_KEY]: blockedUrls });
  await updateRules(blockedUrls);
  return { action: 'success', message: 'URL pattern blocked successfully.' };
}

export async function removeBlockRule(ruleId) {
  const data = await chrome.storage.sync.get({ [STORAGE_KEY]: [] });
  const blockedUrls = data[STORAGE_KEY].filter((urlObj) => urlObj.ruleId !== ruleId);
  await chrome.storage.sync.set({ [STORAGE_KEY]: blockedUrls });
  await updateRules(blockedUrls);
  return { action: 'success', message: 'URL pattern unblocked successfully.' };
}

async function updateRules(blockedUrls) {
  const rules = blockedUrls.map((urlObj, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: urlObj.urlPattern,
      resourceTypes: ['main_frame'],
      excludedInitiatorDomains: [chrome.runtime.getURL('').replace(/\/$/, '')],
    },
  }));

  // Remover TUDO que existe hoje, não só os ids da lista nova: é o que impede
  // uma regra órfã de continuar valendo depois de a URL sair da lista.
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: rules,
  });
}

function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function generateUniqueId() {
  return Math.random().toString(36).substring(2, 15);
}
