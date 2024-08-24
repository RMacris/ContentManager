document.addEventListener('DOMContentLoaded', () => {
    initialize();
  });
  
function initialize() {
  document.getElementById('blockUrl').addEventListener('click', handleBlockUrl);
  loadBlockedUrls();
}

function handleBlockUrl() {
  const url = document.getElementById('url').value;
  chrome.runtime.sendMessage({ action: 'addBlockRule', url }, (response) => {
    if (response) {
      const messageElement = document.getElementById('message');
      displayMessage(response.message, messageElement);
      fadeMessage(messageElement)
      loadBlockedUrls();
    }
  });
}

function loadBlockedUrls() {
  chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
    const blockedUrlsList = document.getElementById('blockedUrlsList');
    clearBlockedUrlsList(blockedUrlsList);
    populateBlockedUrlsList(blockedUrlsList, data.blockedUrls);
  });
}

function clearBlockedUrlsList(blockedUrlsList) {
  blockedUrlsList.innerHTML = ''; // Clear existing list
}

function populateBlockedUrlsList(blockedUrlsList, blockedUrls) {
  blockedUrls.forEach((urlObj) => {
    const li = createBlockedUrlListItem(urlObj);
    blockedUrlsList.appendChild(li);
  });
}

function createBlockedUrlListItem(urlObj) {
  const li = document.createElement('li');
  li.textContent = urlObj.urlPattern;
  
  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'Remove';
  removeBtn.classList.add('remove-btn');
  removeBtn.addEventListener('click', () => handleRemoveBlockRule(urlObj.ruleId));
  
  li.appendChild(removeBtn);
  return li;
}

function handleRemoveBlockRule(ruleId) {
  const messageElement = document.getElementById('message');
  chrome.runtime.sendMessage({ action: 'removeBlockRule', ruleId }, (response) => {
    if (response) {
      displayUnblockedMessage(response.message, messageElement);
      fadeMessage(messageElement)
      loadBlockedUrls(); // Reload the list after removal
    }
  });
}
function displayUnblockedMessage(message, messageElement) {
  messageElement.style.backgroundColor = "#ff0000";
  messageElement.style.color = "#ffffff"; 
  messageElement.style.borderColor = "#8b0000"; 

  displayMessage(message, messageElement);
}
function displayMessage(message, messageElement) {
  messageElement.innerText = message;
  messageElement.style.display = 'block';
  messageElement.style.opacity = 1;
}

function hideMessage(opacity, messageElement) {
  messageElement.style.opacity = opacity
}

function fadeMessage(messageElement) {
  setTimeout(() => { 
    let progress = 0;
      const interval = setInterval(() => {
        progress += 0.1;
        if (progress >= 1) {
            progress = 1;
        }
        const opacity = 1 - progress
        hideMessage(opacity, messageElement);
        if (progress === 1) {
            clearInterval(interval);
        }
    }, 100);
  }, 1500);
}
