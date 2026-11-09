/** Popup da extensão. O service worker valida, aplica e persiste as alterações. */
const IS_SIDE_PANEL = typeof location !== 'undefined' && location.search.includes('surface=sidepanel');
if (IS_SIDE_PANEL && document.body) document.body.classList.add('sidepanel-surface');

// A política das listas vem de `content/channel-rules.js`, carregado antes
// deste script pelo popup.html. A tela é só um adaptador.
const channelRules = globalThis.YTIChannelRules;

const DEFAULT_SETTINGS = {
  hideOldVideos: true,
  hideGamesAndAds: true,
  maxAgeDays: 3,
  blockKeywords: false,
  blockedKeywords: null,
  blockedChannels: null,
  allowedChannels: [],
};
const MIN_AGE_DAYS = 1;
const MAX_AGE_DAYS = 365;
const MAX_SUGGESTIONS = 8;

let savedSettings = { ...DEFAULT_SETTINGS };
let channelCatalog = [];
let allowMatches = [];

document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
  document.getElementById('blockForm').addEventListener('submit', handleBlockUrl);
  document.getElementById('hideOldVideos').addEventListener('change', handleHideOldVideos);
  document.getElementById('hideGamesAndAds').addEventListener('change', handleHideGamesAndAds);
  document.getElementById('maxAgeDays').addEventListener('change', handleMaxAgeDays);
  document.getElementById('blockKeywords').addEventListener('change', handleBlockKeywords);
  document.getElementById('keywordForm').addEventListener('submit', handleAddKeyword);
  document.getElementById('channelForm').addEventListener('submit', handleAddChannel);
  document.getElementById('allowForm').addEventListener('submit', handleAddAllowed);
  document.getElementById('allowInput').addEventListener('input', renderAllowSuggestions);
  document.getElementById('openChannelsPage').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.youtube.com/feed/channels' });
  });

  const sidePanelButton = document.getElementById('openSidePanel');
  sidePanelButton.addEventListener('click', handleOpenSidePanel);
  if (!chrome.sidePanel?.open) sidePanelButton.hidden = true;

  await Promise.all([loadBlockedUrls(), loadStatus(), loadChannelCatalog()]);
}

/* ------------------------------------------------------------ painel lateral */

/** Abre esta mesma tela no painel lateral do Chrome, à direita da janela. */
async function handleOpenSidePanel() {
  const button = document.getElementById('openSidePanel');
  button.disabled = true;
  try {
    const windowId = chrome.windows?.WINDOW_ID_CURRENT;
    await chrome.sidePanel.open(windowId === undefined ? {} : { windowId });
    if (typeof window !== 'undefined') window.close();
  } catch {
    button.disabled = false;
    displayMessage('message', 'Não foi possível abrir o painel lateral. Atualize o Chrome e tente novamente.', true);
  }
}

/* ------------------------------------------------------------------ bloqueio */

async function handleBlockUrl(event) {
  event.preventDefault();
  const input = document.getElementById('url');
  const button = document.getElementById('blockUrl');
  const url = input.value.trim();

  if (!url) {
    displayMessage('message', 'Digite uma expressão regular para bloquear.', true);
    input.focus();
    return;
  }

  button.disabled = true;
  try {
    const response = await sendMessage({ action: 'addBlockRule', url });
    await refreshBlockedUrls();
    input.value = '';
    displayMessage('message', response.message, false);
  } catch (error) {
    displayMessage('message', error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function loadBlockedUrls() {
  try {
    await refreshBlockedUrls();
  } catch (error) {
    displayMessage('message', error.message, true);
  }
}

async function refreshBlockedUrls() {
  const response = await sendMessage({ action: 'getBlockedUrls' });
  if (response.action !== 'blockedUrls' || !Array.isArray(response.blockedUrls)) {
    throw new Error('Não foi possível carregar a lista de sites bloqueados.');
  }

  const blockedUrls = response.blockedUrls;
  const list = document.getElementById('blockedUrlsList');
  list.innerHTML = '';
  blockedUrls.forEach((urlObj) => list.appendChild(createBlockedUrlListItem(urlObj)));

  document.getElementById('blockedCount').textContent = String(blockedUrls.length);
  list.hidden = blockedUrls.length === 0;
  document.getElementById('emptyBlocked').hidden = blockedUrls.length > 0;
}

function createBlockedUrlListItem(urlObj) {
  const li = document.createElement('li');
  li.className = 'blocked-item';

  const pattern = document.createElement('code');
  pattern.className = 'blocked-pattern';
  pattern.textContent = urlObj.urlPattern;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'remove-button';
  removeButton.textContent = 'Remover';
  removeButton.setAttribute('aria-label', `Remover ${urlObj.urlPattern}`);
  removeButton.addEventListener('click', () => handleRemoveBlockRule(urlObj.ruleId, removeButton));

  li.appendChild(pattern);
  li.appendChild(removeButton);
  return li;
}

async function handleRemoveBlockRule(ruleId, button) {
  button.disabled = true;
  try {
    const response = await sendMessage({ action: 'removeBlockRule', ruleId });
    await refreshBlockedUrls();
    displayMessage('message', response.message, false);
  } catch (error) {
    button.disabled = false;
    displayMessage('message', error.message, true);
  }
}

/* -------------------------------------------------------------------- filtro */

async function loadStatus() {
  const controls = [
    document.getElementById('hideOldVideos'),
    document.getElementById('hideGamesAndAds'),
    document.getElementById('maxAgeDays'),
    document.getElementById('blockKeywords'),
  ];
  controls.forEach((control) => {
    control.disabled = true;
  });

  try {
    const status = await sendMessage({ action: 'status' });
    if (status.action !== 'status' || !status.settings) {
      throw new Error('Não foi possível carregar as preferências do filtro.');
    }
    savedSettings = { ...DEFAULT_SETTINGS, ...status.settings };
    updateSettingsControls();
  } catch (error) {
    savedSettings = { ...DEFAULT_SETTINGS };
    updateSettingsControls();
    displayMessage('filterMessage', error.message, true);
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
  }
}

function updateSettingsControls() {
  document.getElementById('hideOldVideos').checked = savedSettings.hideOldVideos !== false;
  document.getElementById('hideGamesAndAds').checked = savedSettings.hideGamesAndAds !== false;
  document.getElementById('maxAgeDays').value = String(savedSettings.maxAgeDays);
  document.getElementById('blockKeywords').checked = savedSettings.blockKeywords === true;
  renderKeywordList();
  renderChannelList();
  renderAllowedChannels();
}

async function handleHideOldVideos() {
  const control = document.getElementById('hideOldVideos');
  const checked = control.checked;
  const message = checked ? 'Filtro de vídeos antigos ativado.' : 'Filtro de vídeos antigos desativado.';
  await persistSetting('hideOldVideos', checked, control, message);
}

async function handleHideGamesAndAds() {
  const control = document.getElementById('hideGamesAndAds');
  const checked = control.checked;
  const message = checked ? 'Jogos e anúncios serão ocultados.' : 'Jogos e anúncios ficarão visíveis.';
  await persistSetting('hideGamesAndAds', checked, control, message);
}

async function handleMaxAgeDays() {
  const control = document.getElementById('maxAgeDays');
  const maxAgeDays = Number(control.value);
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < MIN_AGE_DAYS || maxAgeDays > MAX_AGE_DAYS) {
    control.value = String(savedSettings.maxAgeDays);
    displayMessage('filterMessage', `Escolha um número inteiro entre ${MIN_AGE_DAYS} e ${MAX_AGE_DAYS} dias.`, true);
    return;
  }

  await persistSetting('maxAgeDays', maxAgeDays, control, `Limite salvo: ${maxAgeDays} dias.`);
}

async function handleBlockKeywords() {
  const control = document.getElementById('blockKeywords');
  const checked = control.checked;
  const message = checked
    ? 'Palavras-chave e canais serão bloqueados nos títulos e canais dos vídeos.'
    : 'Bloqueio por palavras-chave e canais desativado.';
  await persistSetting('blockKeywords', checked, control, message);
}

/* ------------------------------------------------------- palavras e canais */

async function handleAddKeyword(event) {
  event.preventDefault();
  await addListItem('keywordInput', 'blockedKeywords', 'Palavra-chave');
}

async function handleAddChannel(event) {
  event.preventDefault();
  await addListItem('channelInput', 'blockedChannels', 'Canal');
}

/** Enter (ou o botão) adiciona à lista; repetido e vazio não entram. */
async function addListItem(inputId, settingsKey, label) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) {
    displayMessage('keywordMessage', `Digite o ${label.toLowerCase()} a adicionar.`, true);
    input.focus();
    return;
  }

  const current = Array.isArray(savedSettings[settingsKey]) ? savedSettings[settingsKey] : [];
  if (channelRules.hasListItem(current, value)) {
    displayMessage('keywordMessage', `“${value}” já está na lista.`, true);
    return;
  }

  const saved = await persistList(settingsKey, [...current, value], `${value} adicionado.`);
  if (saved) input.value = '';
}

async function removeListItem(settingsKey, value) {
  const current = Array.isArray(savedSettings[settingsKey]) ? savedSettings[settingsKey] : [];
  await persistList(settingsKey, current.filter((item) => item !== value), `${value} removido.`);
}

/** Salva a lista inteira e devolve as badges ao que está guardado. */
async function persistList(settingsKey, nextValues, successMessage) {
  try {
    const response = await sendMessage({ action: 'saveSettings', patch: { [settingsKey]: nextValues } });
    if (response.action !== 'saveSettings' || response.ok !== true) {
      throw new Error('Não foi possível salvar a lista.');
    }
    savedSettings = { ...savedSettings, ...response.settings };
    renderKeywordList();
    renderChannelList();
    displayMessage('keywordMessage', successMessage, false);
    return true;
  } catch (error) {
    renderKeywordList();
    renderChannelList();
    displayMessage('keywordMessage', error.message, true);
    return false;
  }
}

function renderKeywordList() {
  const values = Array.isArray(savedSettings.blockedKeywords) ? savedSettings.blockedKeywords : [];
  renderBadges('keywordBadges', 'keywordCount', 'keywordEmpty', values, 'blockedKeywords');
}

function renderChannelList() {
  const values = Array.isArray(savedSettings.blockedChannels) ? savedSettings.blockedChannels : [];
  renderBadges('channelBadges', 'channelCount', 'channelEmpty', values, 'blockedChannels');
}

function renderBadges(containerId, countId, emptyId, values, settingsKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  values.forEach((value) => container.appendChild(createBadge(value, settingsKey)));

  document.getElementById(countId).textContent = String(values.length);
  document.getElementById(emptyId).hidden = values.length > 0;
}

/** A badge com o texto e o botão “×” que tira o item da lista. */
function createBadge(value, settingsKey) {
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = value;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'badge-remove';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', `Remover ${value}`);
  removeButton.addEventListener('click', async () => {
    await removeListItem(settingsKey, value);
  });

  badge.appendChild(removeButton);
  return badge;
}

async function persistSetting(key, value, control, successMessage) {
  const previousValue = savedSettings[key];
  control.disabled = true;
  try {
    const response = await sendMessage({ action: 'saveSettings', patch: { [key]: value } });
    if (response.action !== 'saveSettings' || response.ok !== true) {
      throw new Error('Não foi possível salvar esta preferência.');
    }

    savedSettings = { ...savedSettings, ...response.settings };
    displayMessage('filterMessage', successMessage, false);
  } catch (error) {
    savedSettings[key] = previousValue;
    if (control.type === 'checkbox') control.checked = previousValue;
    else control.value = String(previousValue);
    displayMessage('filterMessage', error.message, true);
  } finally {
    control.disabled = false;
  }
}

/* --------------------------------------------------- sempre recomendados */

async function loadChannelCatalog() {
  try {
    const response = await sendMessage({ action: 'getChannelCatalog' });
    if (response.action !== 'channelCatalog' || !response.catalog || !Array.isArray(response.catalog.channels)) {
      throw new Error('Não foi possível carregar os canais inscritos.');
    }
    channelCatalog = response.catalog.channels;
    document.getElementById('allowHint').textContent =
      channelCatalog.length === 0
        ? 'Nenhum canal coletado ainda. Abra a página de inscrições para a extensão guardar a lista.'
        : `${channelCatalog.length} canais inscritos coletados. Digite o nome e escolha a sugestão.`;
  } catch (error) {
    channelCatalog = [];
    displayMessage('allowMessage', error.message, true);
  }
}

function normalizeChannelText(value) {
  return channelRules.normalizeChannelName(value);
}

function searchCatalog(needle) {
  const matches = [];
  for (const entry of channelCatalog) {
    const name = channelRules.normalizeChannelName(entry.name);
    const handle = channelRules.normalizeHandle(entry.handle);
    if (name.includes(needle) || handle.includes(needle)) matches.push(entry);
    if (matches.length >= MAX_SUGGESTIONS) break;
  }
  return matches;
}

/** A busca da allowlist: só as inscrições guardadas, sem chamada de rede. */
function renderAllowSuggestions() {
  const query = normalizeChannelText(document.getElementById('allowInput').value);
  const container = document.getElementById('allowSuggestions');
  allowMatches = query === '' ? [] : searchCatalog(query);
  container.innerHTML = '';
  container.hidden = allowMatches.length === 0;
  allowMatches.forEach((entry) => container.appendChild(createSuggestion(entry)));
}

function createSuggestion(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'suggestion';
  button.appendChild(createChannelAvatar(entry, 'suggestion-avatar', 'avatar-fallback'));

  const copy = document.createElement('span');
  copy.className = 'suggestion-copy';
  const name = document.createElement('span');
  name.className = 'suggestion-name';
  name.textContent = entry.name;
  copy.appendChild(name);
  if (entry.handle) {
    const handle = document.createElement('span');
    handle.className = 'suggestion-handle';
    handle.textContent = entry.handle;
    copy.appendChild(handle);
  }
  button.appendChild(copy);

  button.addEventListener('click', async () => {
    await addAllowedChannel(entry);
  });
  return button;
}

async function handleAddAllowed(event) {
  event.preventDefault();
  if (allowMatches.length === 0) renderAllowSuggestions();
  if (allowMatches.length === 0) {
    displayMessage('allowMessage', 'Nenhum canal encontrado nas suas inscrições com esse nome.', true);
    return;
  }
  await addAllowedChannel(allowMatches[0]);
}

async function addAllowedChannel(entry) {
  const current = Array.isArray(savedSettings.allowedChannels) ? savedSettings.allowedChannels : [];
  if (current.some((item) => channelRules.sameChannel(item, entry))) {
    displayMessage('allowMessage', `“${entry.name}” já está na lista.`, true);
    return;
  }

  const next = [...current, { name: entry.name, handle: entry.handle || '' }];
  const saved = await persistAllowed(next, `${entry.name} sempre será recomendado.`);
  if (saved) {
    document.getElementById('allowInput').value = '';
    renderAllowSuggestions();
  }
}

async function persistAllowed(nextValues, successMessage) {
  try {
    const response = await sendMessage({ action: 'saveSettings', patch: { allowedChannels: nextValues } });
    if (response.action !== 'saveSettings' || response.ok !== true) {
      throw new Error('Não foi possível salvar a lista.');
    }
    savedSettings = { ...savedSettings, ...response.settings };
    renderAllowedChannels();
    displayMessage('allowMessage', successMessage, false);
    return true;
  } catch (error) {
    renderAllowedChannels();
    displayMessage('allowMessage', error.message, true);
    return false;
  }
}

/** As badges da allowlist: foto (do catálogo) + nome + o “×” que remove. */
function renderAllowedChannels() {
  const values = Array.isArray(savedSettings.allowedChannels) ? savedSettings.allowedChannels : [];
  const container = document.getElementById('allowedBadges');
  container.innerHTML = '';
  values.forEach((entry) => container.appendChild(createAllowedBadge(entry)));

  document.getElementById('allowedCount').textContent = String(values.length);
  document.getElementById('allowedEmpty').hidden = values.length > 0;
}

function createAllowedBadge(entry) {
  const badge = document.createElement('span');
  badge.className = 'badge allowed-badge';
  badge.appendChild(createChannelAvatar(entry, 'allowed-avatar', 'allowed-avatar-fallback'));

  const name = document.createElement('span');
  name.className = 'allowed-name';
  name.textContent = entry.name;
  badge.appendChild(name);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'badge-remove';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', `Remover ${entry.name}`);
  removeButton.addEventListener('click', async () => {
    const current = Array.isArray(savedSettings.allowedChannels) ? savedSettings.allowedChannels : [];
    await persistAllowed(
      current.filter((item) => !channelRules.sameChannel(item, entry)),
      `${entry.name} removido dos sempre recomendados.`,
    );
  });
  badge.appendChild(removeButton);
  return badge;
}

function createChannelAvatar(entry, imageClass, fallbackClass) {
  const url = avatarFor(entry);
  if (url !== '') {
    const image = document.createElement('img');
    image.className = imageClass;
    image.src = url;
    image.alt = '';
    return image;
  }

  const fallback = document.createElement('span');
  fallback.className = fallbackClass;
  fallback.textContent = entry.name.slice(0, 1).toUpperCase();
  return fallback;
}

/** A foto mora no catálogo local; a allowlist no sync guarda só nome e handle. */
function avatarFor(entry) {
  const handle = channelRules.normalizeHandle(entry.handle);
  const name = channelRules.normalizeChannelName(entry.name);
  const found = channelCatalog.find((item) => {
    const itemHandle = channelRules.normalizeHandle(item.handle);
    return (handle !== '' && itemHandle === handle) || channelRules.normalizeChannelName(item.name) === name;
  });
  return found && found.avatarUrl ? found.avatarUrl : '';
}

/* ------------------------------------------------------------------ utilidades */

async function sendMessage(message) {
  let response;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error ?? '');
    if (/could not establish connection|receiving end does not exist/i.test(detail)) {
      throw new Error('Não foi possível conectar ao serviço da extensão. Recarregue-a em chrome://extensions e tente novamente.');
    }
    throw new Error(detail || 'Não foi possível falar com a extensão.');
  }

  if (!response) throw new Error('A extensão não respondeu. Tente novamente.');
  if (response.action === 'error') throw new Error(response.message || 'A operação não foi concluída.');
  return response;
}

function displayMessage(elementId, text, isError) {
  const element = document.getElementById(elementId);
  element.textContent = String(text);
  element.className = `message ${isError ? 'error' : 'success'}`;
  element.setAttribute('role', isError ? 'alert' : 'status');
  element.hidden = false;
}
