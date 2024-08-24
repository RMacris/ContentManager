chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
  const blockedUrls = data.blockedUrls;

  // Initial check
  checkUrl(window.location.href);

  // Set up observers and event listeners
  observeMutations();
  observeHistoryChanges();

  function checkUrl(url) {
    for (const blockedUrl of blockedUrls) {
      const urlPattern = new RegExp(blockedUrl.urlPattern);
      if (urlPattern.test(url)) {
        window.location.href = chrome.runtime.getURL("blocked.html"); // Redirect to blocked page
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
    history.pushState = createHistoryHandler(history.pushState, 'pushstate');
    history.replaceState = createHistoryHandler(history.replaceState, 'replacestate');

    window.addEventListener('popstate', () => {
      window.dispatchEvent(new Event('locationchange'));
    });

    window.addEventListener('locationchange', () => {
      checkUrl(window.location.href);
    });
  }

  function createHistoryHandler(originalFunction, eventName) {
    return function() {
      const result = originalFunction.apply(this, arguments);
      window.dispatchEvent(new Event(eventName));
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
  }
});
  