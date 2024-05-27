chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
    const blockedUrls = data.blockedUrls;
  
    function checkUrl(url) {
      for (const blockedUrl of blockedUrls) {
        const urlPattern = new RegExp(blockedUrl.urlPattern);
        if (urlPattern.test(url)) {
          window.location.href = "about:blank"; // Redirect to a blank page or a custom page
          break;
        }
      }
    }
  
    // Initial check
    checkUrl(window.location.href);
  
    // Monitor for URL changes
    const observer = new MutationObserver(() => {
      checkUrl(window.location.href);
    });
  
    observer.observe(document, { subtree: true, childList: true });
  
    // Monitor history changes (for single-page applications)
    history.pushState = ((f) =>
      function pushState(){
        const ret = f.apply(this, arguments);
        window.dispatchEvent(new Event('pushstate'));
        window.dispatchEvent(new Event('locationchange'));
        return ret;
    })(history.pushState);
  
    history.replaceState = ((f) =>
      function replaceState(){
        const ret = f.apply(this, arguments);
        window.dispatchEvent(new Event('replacestate'));
        window.dispatchEvent(new Event('locationchange'));
        return ret;
    })(history.replaceState);
  
    window.addEventListener('popstate', () => {
      window.dispatchEvent(new Event('locationchange'))
    });
  
    window.addEventListener('locationchange', () => {
      checkUrl(window.location.href);
    });
  });
  