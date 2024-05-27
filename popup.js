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
        displayMessage(response.message);
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
    chrome.runtime.sendMessage({ action: 'removeBlockRule', ruleId }, (response) => {
      if (response) {
        displayMessage(response.message);
        loadBlockedUrls(); // Reload the list after removal
      }
    });
  }
  
  function displayMessage(message) {
    const messageElement = document.getElementById('message');
    messageElement.innerText = message;
    messageElement.style.display = 'block';
  }
  