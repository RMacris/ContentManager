// Returns a promise for the blocked URLs
function getBlockedUrls() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
      resolve(data.blockedUrls);
    });
  });
}

// Returns a promise for the remove Shorts flag
function isRemoveShortsEnabled() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("removeYoutubeHeelsElements", (data) => {
      // Ensure a boolean value is returned
      console.log("removeYoutubeHeelsElements", data.removeYoutubeHeelsElements);
      resolve(!!data.removeYoutubeHeelsElements);
    });
  });
}

function removeHeelsElements() {
  // Select all <span> elements and filter those with text containing "shorts"
  const allSpans = document.querySelectorAll("span#title");
  const filtered = Array.from(allSpans).filter((element) => 
    element.innerText.toLowerCase().includes("shorts")
  );

  // For each matching element, traverse up until finding a parent with id "dismissable" or "title-container"
  // if find "title-container" first, continue iterating to check if there is a parent with id "dismissable" if so, remove this instead
  // otherwise remove the grandparent of the title-container
  for (const element of filtered) {
    let parent = element.parentElement;
    let titleContainerElement = null;
    let dismissibleElement = null;

    while (parent) {
      if (parent.id.toLowerCase().includes("dismissible")) {
        dismissibleElement = parent;
        break;
      }
      if (parent.id.toLowerCase().includes("title-container")) {
        titleContainerElement = parent;
      }
      parent = parent.parentElement;
    }

    if (dismissibleElement) {
      console.log("Removing dismissible element", dismissibleElement);
      dismissibleElement.style.display = "none";
      dismissibleElement.remove();
    } else if (titleContainerElement) {
      const grandParent = titleContainerElement.parentElement;
      if (grandParent) {
        console.log("Removing grandparent of title-container", grandParent);
        grandParent.style.display = "none";
        grandParent.remove();
      }
    }
  }
}


// Observe mutations in the document and check for new content
function observeMutations() {
  const observer = new MutationObserver(() => {
    checkUrl(window.location.href);

    // Every time the DOM changes, check if the removal feature is enabled and call the function
    isRemoveShortsEnabled().then((removeShorts) => {
      if (removeShorts) {
        removeHeelsElements();
      }
    });
  });

  // Observe changes in the entire document
  observer.observe(document, { subtree: true, childList: true });
}

function checkUrl(url) {
  chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
    const blockedUrls = data.blockedUrls;
    for (const blockedUrl of blockedUrls) {
      const urlPattern = new RegExp(blockedUrl.urlPattern);
      if (urlPattern.test(url)) {
        window.location.href = chrome.runtime.getURL("blocked.html");
        break;
      }
    }
  });
}

// Observe history changes (if needed)
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
  return function () {
    const result = originalFunction.apply(this, arguments);
    window.dispatchEvent(new Event(eventName));
    window.dispatchEvent(new Event('locationchange'));
    return result;
  };
}

// Main function to set everything up
async function main() {
  // Initial URL check and mutation observer setup
  checkUrl(window.location.href);
  observeMutations();
  observeHistoryChanges();

  // Optionally, remove YouTube Shorts elements immediately if enabled
  const removeShorts = await isRemoveShortsEnabled();
  if (removeShorts) {
    removeHeelsElements();
  }
}

// Run the main function once the document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
