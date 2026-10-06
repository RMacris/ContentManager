/**
 * Guarda de bloqueio — roda em toda página e redireciona para a página de aviso
 * quando a URL casa com algum padrão bloqueado.
 *
 * Script de conteúdo clássico: o Chrome não carrega módulos ES aqui, então este
 * arquivo não importa nada e é autossuficiente de propósito.
 */
chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
  const blockedUrls = data.blockedUrls;

  checkUrl(window.location.href);
  observeMutations();
  observeHistoryChanges();

  function checkUrl(url) {
    for (const blockedUrl of blockedUrls) {
      const urlPattern = new RegExp(blockedUrl.urlPattern);
      if (urlPattern.test(url)) {
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
});
