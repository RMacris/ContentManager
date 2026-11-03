/**
 * Guarda de bloqueio — roda em toda página e redireciona para a página de aviso
 * quando a URL casa com algum padrão bloqueado.
 *
 * Script de conteúdo clássico: o Chrome não carrega módulos ES aqui, então este
 * arquivo não importa nada e é autossuficiente de propósito.
 */
let blockedUrlPatterns = [];
let rulesRevision = 0;

const initialRulesRevision = rulesRevision;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.blockedUrls) return;
  rulesRevision += 1;
  setBlockedUrls(changes.blockedUrls.newValue);
});

chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
  if (rulesRevision !== initialRulesRevision) return;
  setBlockedUrls(data.blockedUrls);
});

observeMutations();
observeHistoryChanges();

function setBlockedUrls(blockedUrls) {
  blockedUrlPatterns = [];
  if (Array.isArray(blockedUrls)) {
    for (const blockedUrl of blockedUrls) {
      if (!blockedUrl || typeof blockedUrl.urlPattern !== 'string') continue;
      try {
        blockedUrlPatterns.push(new RegExp(blockedUrl.urlPattern));
      } catch {
        // Ignore malformed legacy values instead of breaking the page guard.
      }
    }
  }
  checkUrl(window.location.href);
}

function checkUrl(url) {
  for (const pattern of blockedUrlPatterns) {
    if (pattern.test(url)) {
      window.location.href = chrome.runtime.getURL('blocked.html');
      break;
    }
  }
}

function observeMutations() {
  const observer = new MutationObserver(() => {
    checkUrl(window.location.href);
  });

  observer.observe(document, { subtree: true, childList: true });
}

function observeHistoryChanges() {
  history.pushState = createHistoryHandler(history.pushState);
  history.replaceState = createHistoryHandler(history.replaceState);

  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('locationchange'));
  });

  window.addEventListener('locationchange', () => {
    checkUrl(window.location.href);
  });
}

function createHistoryHandler(originalFunction) {
  return function () {
    const result = originalFunction.apply(this, arguments);
    window.dispatchEvent(new Event('pushstate'));
    window.dispatchEvent(new Event('locationchange'));
    return result;
  };
}
