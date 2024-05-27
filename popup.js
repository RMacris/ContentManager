document.getElementById('blockUrl').addEventListener('click', () => {
    const url = document.getElementById('url').value;
    chrome.runtime.sendMessage({ action: 'addBlockRule', url }, (response) => {
      if (response) {
        document.getElementById('message').innerText = response.message;
        loadBlockedUrls();
      }
    });
  });
  
  function loadBlockedUrls() {
    chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
      const blockedUrlsList = document.getElementById('blockedUrlsList');
      blockedUrlsList.innerHTML = ''; // Clear existing list
      data.blockedUrls.forEach((urlObj) => {
        const li = document.createElement('li');
        li.textContent = urlObj.urlPattern;
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.classList.add('remove-btn');
        removeBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'removeBlockRule', ruleId: urlObj.ruleId }, (response) => {
            if (response) {
              document.getElementById('message').innerText = response.message;
              loadBlockedUrls(); // Reload the list after removal
            }
          });
        });
        li.appendChild(removeBtn);
        blockedUrlsList.appendChild(li);
      });
    });
  }
  
  // Load blocked URLs when the popup is opened
  document.addEventListener('DOMContentLoaded', loadBlockedUrls);
  