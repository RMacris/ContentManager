/**
 * O bloqueio de URLs — a funcionalidade original da extensão, preservada.
 *
 * As expressões são regras dinâmicas do Chrome. Primeiro atualizamos o DNR e só
 * depois persistimos a lista; se a API rejeitar a regra, a interface recebe o
 * erro sem deixar a lista e o bloqueio fora de sincronia.
 */

const STORAGE_KEY = 'blockedUrls';
let rulesQueue = Promise.resolve();

export function initializeRules() {
  return serialize(async () => {
    await updateRules(await getBlockedUrls());
  });
}

export async function getBlockedUrls() {
  const data = await chrome.storage.sync.get({ [STORAGE_KEY]: [] });
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

export function addBlockRule(urlPattern) {
  return serialize(async () => {
    const pattern = String(urlPattern ?? '').trim();
    if (!pattern) {
      return { action: 'error', message: 'Informe uma expressão regular.' };
    }
    if (!(await isValidRegex(pattern))) {
      return { action: 'error', message: 'A expressão regular é inválida ou não é compatível com o Chrome.' };
    }

    const blockedUrls = await getBlockedUrls();
    if (blockedUrls.some((urlObj) => urlObj.urlPattern === pattern)) {
      return { action: 'error', message: 'Esse padrão já está na lista.' };
    }

    const nextBlockedUrls = [...blockedUrls, { urlPattern: pattern, ruleId: generateUniqueId() }];
    await saveBlockedUrls(nextBlockedUrls, blockedUrls);
    return { action: 'success', message: 'Padrão adicionado.' };
  });
}

export function removeBlockRule(ruleId) {
  return serialize(async () => {
    const blockedUrls = await getBlockedUrls();
    const nextBlockedUrls = blockedUrls.filter((urlObj) => urlObj.ruleId !== ruleId);
    if (nextBlockedUrls.length === blockedUrls.length) {
      return { action: 'error', message: 'Esse padrão não está mais na lista.' };
    }

    await saveBlockedUrls(nextBlockedUrls, blockedUrls);
    return { action: 'success', message: 'Padrão removido.' };
  });
}

async function updateRules(blockedUrls) {
  const rules = blockedUrls.map((urlObj, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: 'block' },
    condition: {
      regexFilter: urlObj.urlPattern,
      resourceTypes: ['main_frame'],
    },
  }));

  // Remover TUDO que existe hoje, não só os ids da lista nova: é o que impede
  // uma regra órfã de continuar valendo depois de a URL sair da lista.
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (areRulesCurrent(existing, rules)) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: rules,
  });
}

function areRulesCurrent(existingRules, desiredRules) {
  if (existingRules.length !== desiredRules.length) return false;

  const existingById = new Map(existingRules.map((rule) => [rule.id, rule]));
  return desiredRules.every((desiredRule) => {
    const existingRule = existingById.get(desiredRule.id);
    if (existingRule === undefined || existingRule.priority !== desiredRule.priority) return false;
    return areObjectsEqual(existingRule.action, desiredRule.action) &&
      areObjectsEqual(existingRule.condition, desiredRule.condition);
  });
}

function areObjectsEqual(existing, desired) {
  if (existing === null || typeof existing !== 'object') return false;

  const existingKeys = Object.keys(existing).sort();
  const desiredKeys = Object.keys(desired).sort();
  if (existingKeys.length !== desiredKeys.length) return false;
  if (!existingKeys.every((key, index) => key === desiredKeys[index])) return false;

  return desiredKeys.every((key) => {
    const desiredValue = desired[key];
    const existingValue = existing[key];
    if (!Array.isArray(desiredValue)) return existingValue === desiredValue;
    return Array.isArray(existingValue) &&
      existingValue.length === desiredValue.length &&
      existingValue.every((value, index) => value === desiredValue[index]);
  });
}

async function saveBlockedUrls(nextBlockedUrls, previousBlockedUrls) {
  await updateRules(nextBlockedUrls);
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: nextBlockedUrls });
  } catch (error) {
    await updateRules(previousBlockedUrls);
    throw error;
  }
}

function serialize(operation) {
  const result = rulesQueue.then(operation, operation);
  rulesQueue = result.catch(() => {});
  return result;
}

async function isValidRegex(pattern) {
  if (typeof chrome.declarativeNetRequest.isRegexSupported === 'function') {
    try {
      const result = await chrome.declarativeNetRequest.isRegexSupported({ regex: pattern });
      return result.isSupported === true;
    } catch {
      return false;
    }
  }

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
