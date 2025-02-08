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

function loadYoutubeShortsCheckboxValue() {
  chrome.storage.sync.get('removeYoutubeHeelsElements', (data) => {
    const checkbox = document.getElementById('blockYoutubeShorts');
    checkbox.checked = data.removeYoutubeHeelsElements;
  });
}
loadYoutubeShortsCheckboxValue();

function checkCheckboxStatus() {
  console.log('checkCheckboxStatus being called '   );
  const checkbox = document.getElementById('blockYoutubeShorts');
  const status = checkbox.checked;

  chrome.runtime.sendMessage({
    action: 'removeYoutubeHeelsElements',
    message: status
  }).then(response => {
    console.log('Status updated:', response.message);
  }).catch(error => {
    console.error('Error updating status:', error);
  });
}

function attachToCheckboxWrapper() {
  const checkboxWrapper = document.getElementById('checkboxWrapper');

  // create label and checkbox
  const label = document.createElement('label');
  label.setAttribute('for', 'blockYoutubeShorts'); 
  label.textContent = 'Block YouTube Shorts';

  const checkbox = document.createElement('input');
  checkbox.setAttribute('type', 'checkbox');
  checkbox.setAttribute('id', 'blockYoutubeShorts');
  checkbox.setAttribute('name', 'blockYoutubeShorts');

  // append label and checkbox to wrapper
  checkboxWrapper.appendChild(label);
  checkboxWrapper.appendChild(checkbox);

  checkbox.addEventListener('change', checkCheckboxStatus);
}
attachToCheckboxWrapper();
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
