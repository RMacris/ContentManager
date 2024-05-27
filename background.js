chrome.runtime.onInstalled.addListener(initializeRules);
chrome.runtime.onMessage.addListener(handleMessages);

function initializeRules() {
  chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
    updateRules(data.blockedUrls);
  });
}

function handleMessages(message, sender, sendResponse) {
  if (message.action === "addBlockRule") {
    addBlockRule(message.url.trim(), sendResponse);
    return true; // Keep the message channel open for async response
  } else if (message.action === "removeBlockRule") {
    removeBlockRule(message.ruleId, sendResponse);
    return true; // Keep the message channel open for async response
  }
}

function addBlockRule(urlPattern, sendResponse) {
  if (!isValidRegex(urlPattern)) {
    sendResponse({ action: "error", message: "Invalid regex pattern." });
    return;
  }

  const ruleId = generateUniqueId();

  chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
    const blockedUrls = data.blockedUrls;
    blockedUrls.push({ urlPattern, ruleId });
    chrome.storage.sync.set({ blockedUrls }, () => {
      updateRules(blockedUrls);
      sendResponse({ action: "success", message: "URL pattern blocked successfully." });
    });
  });
}

function removeBlockRule(ruleId, sendResponse) {
  chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
    const blockedUrls = data.blockedUrls.filter(urlObj => urlObj.ruleId !== ruleId);
    chrome.storage.sync.set({ blockedUrls }, () => {
      updateRules(blockedUrls);
      sendResponse({ action: "success", message: "URL pattern unblocked successfully." });
    });
  });
}

function updateRules(blockedUrls) {
  const rules = blockedUrls.map((urlObj, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: urlObj.urlPattern }
  }));

  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: rules.map(rule => rule.id),
    addRules: rules
  });
}

function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
}

function generateUniqueId() {
  return Math.random().toString(36).substring(2, 15);
}
