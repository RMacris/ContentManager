/**
 * Popup: bloqueio de URLs e interruptores do filtro do feed.
 *
 * Script clássico — o popup não carrega módulos ES. Toda a lógica de verdade
 * vive no service worker, que é também quem guarda as preferências.
 */
document.addEventListener('DOMContentLoaded', () => {
  initialize();
});

function initialize() {
  document.getElementById('blockUrl').addEventListener('click', handleBlockUrl);
  document.getElementById('hideOldVideos').addEventListener('change', handleHideOldVideos);
  document.getElementById('hideGamesAndAds').addEventListener('change', handleHideGamesAndAds);
  loadBlockedUrls();
  loadStatus();
}

/* ------------------------------------------------------------------ bloqueio */

async function handleBlockUrl() {
  const url = document.getElementById('url').value;
  const response = await chrome.runtime.sendMessage({ action: 'addBlockRule', url });
  if (response) {
    displayMessage('message', response.message, response.action !== 'success');
    loadBlockedUrls();
  }
}

function loadBlockedUrls() {
  chrome.storage.sync.get({ blockedUrls: [] }, (data) => {
    const list = document.getElementById('blockedUrlsList');
    list.innerHTML = '';
    data.blockedUrls.forEach((urlObj) => list.appendChild(createBlockedUrlListItem(urlObj)));
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

async function handleRemoveBlockRule(ruleId) {
  const response = await chrome.runtime.sendMessage({ action: 'removeBlockRule', ruleId });
  if (response) {
    displayMessage('message', response.message, response.action !== 'success');
    loadBlockedUrls();
  }
}

/* -------------------------------------------------------------------- filtro */

/** Os dois interruptores refletem o que está gravado; ausente é ligado. */
async function loadStatus() {
  const status = await chrome.runtime.sendMessage({ action: 'status' });
  if (!status || status.action !== 'status') return;
  document.getElementById('hideOldVideos').checked = status.settings.hideOldVideos !== false;
  document.getElementById('hideGamesAndAds').checked = status.settings.hideGamesAndAds !== false;
}

/**
 * O filtro de idade vale na hora: a mudança é a própria preferência, e o
 * content script de cada aba do YouTube escuta o `storage`.
 */
async function handleHideOldVideos() {
  const checked = document.getElementById('hideOldVideos').checked;
  await chrome.runtime.sendMessage({ action: 'saveSettings', patch: { hideOldVideos: checked } });
  displayMessage('filterMessage', checked ? 'Filtro ativado.' : 'Filtro desativado.', false);
}

/**
 * Jogo e anúncio não têm data: o interruptor próprio decide se somem, e o
 * content script reage ao `storage` igual ao filtro de idade.
 */
async function handleHideGamesAndAds() {
  const checked = document.getElementById('hideGamesAndAds').checked;
  await chrome.runtime.sendMessage({ action: 'saveSettings', patch: { hideGamesAndAds: checked } });
  displayMessage('filterMessage', checked ? 'Jogos e anúncios ocultos.' : 'Jogos e anúncios visíveis.', false);
}

/* ------------------------------------------------------------------ utilidades */

function displayMessage(elementId, text, isError) {
  const element = document.getElementById(elementId);
  element.innerText = text;
  element.className = `message ${isError ? 'error' : 'ok'}`;
  element.style.display = 'block';
}
