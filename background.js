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
  } else if (message.action === "removeYoutubeHeelsElements") {
    chrome.storage.sync.set({ removeYoutubeHeelsElements: message.message }, () => {
      sendResponse({ action: "success", message: `YouTube Shorts removal status updated. ${message.message}` });
    });
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
      id: index + 1,  // Each rule gets a unique ID based on its index
      priority: 1,    // Priority of the rule, can be adjusted as needed
      action: { type: "block" },  // Action to block the request
      condition: {
        urlFilter: urlObj.urlPattern,  // Condition to match the URL pattern
        resourceTypes: ['main_frame'],  // Only apply the rule to top-level navigation requests
        excludedInitiatorDomains: [chrome.runtime.getURL("").replace(/\/$/, "")]  // Exclude the extension's own domain
      }
    }));

  // Extract the IDs of all current rules for removal
  const ruleIds = rules.map(rule => rule.id);

  // Update the declarativeNetRequest rules:
  // 1. Remove all existing rules that have the same IDs
  // 2. Add the new set of rules
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: rules.map(rule => rule.id), // Remove rules with the same IDs to avoid conflicts
    addRules: rules // Add the new set of rules
  }, () => {
    // Check for errors in updating the rules
    if (chrome.runtime.lastError) {
      console.error("Error updating rules:", chrome.runtime.lastError);
    }
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
