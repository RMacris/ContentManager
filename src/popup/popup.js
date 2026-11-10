/** Popup da extensão. O service worker valida, aplica e persiste as alterações. */
const IS_SIDE_PANEL = typeof location !== 'undefined' && location.search.includes('surface=sidepanel');
if (IS_SIDE_PANEL && document.body) document.body.classList.add('sidepanel-surface');

// A política das listas vem de `content/channel-rules.js` e o schema das
// preferências de `shared/settings-contract.js`, carregados antes deste script
// pelo popup.html. A tela é só um adaptador.
const channelRules = globalThis.YTIChannelRules;
const settingsContract = globalThis.YTISettingsContract;

const MAX_SUGGESTIONS = 8;

let savedSettings = settingsContract.normalizeSettings({});
let channelCatalog = [];
let allowMatches = [];
let selectedMatches = [];
let displayedAgeUnit = 'days';

document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
  applySettingsContract();
  document.getElementById('blockForm').addEventListener('submit', handleBlockUrl);
  document.getElementById('hideOldVideos').addEventListener('change', handleHideOldVideos);
  document.getElementById('hideGamesAndAds').addEventListener('change', handleHideGamesAndAds);
  document.getElementById('maxAge').addEventListener('change', handleMaxAgeChange);
  document.getElementById('maxAgeUnit').addEventListener('change', handleMaxAgeUnitChange);
  document.getElementById('blockKeywords').addEventListener('change', handleBlockKeywords);
  document.getElementById('keywordForm').addEventListener('submit', handleAddKeyword);
  document.getElementById('channelForm').addEventListener('submit', handleAddChannel);
  document.getElementById('allowForm').addEventListener('submit', handleAddAllowed);
  document.getElementById('allowInput').addEventListener('input', renderAllowSuggestions);
  document.getElementById('channelMode').addEventListener('change', handleChannelMode);
  document.getElementById('channelSourceSelected').addEventListener('change', handleChannelModeSource);
  document.getElementById('channelSourceSubscribed').addEventListener('change', handleChannelModeSource);
  document.getElementById('selectedForm').addEventListener('submit', handleAddSelected);
  document.getElementById('selectedInput').addEventListener('input', renderSelectedSuggestions);

  const openChannelsPage = () => {
    chrome.tabs.create({ url: 'https://www.youtube.com/feed/channels' });
  };
  document.getElementById('openChannelsPage').addEventListener('click', openChannelsPage);
  document.getElementById('openChannelsPageFromMode').addEventListener('click', openChannelsPage);

  const sidePanelButton = document.getElementById('openSidePanel');
  sidePanelButton.addEventListener('click', handleOpenSidePanel);
  if (!chrome.sidePanel?.open) sidePanelButton.hidden = true;

  listenForSettingsChanges();
  await Promise.all([loadBlockedUrls(), loadStatus(), loadChannelCatalog()]);
}

/* ------------------------------------------------ sincronização entre telas */

/**
 * O popup e o painel lateral dividem a mesma tela, e o chip do YouTube escreve
 * a mesma lista sem abrir nenhum dos dois. O storage é a fonte única: o que
 * muda fora chega aqui e a tela reflete na hora, sem reabrir.
 */
function listenForSettingsChanges() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    applySettingsChanges(changes);
  });
}

function applySettingsChanges(changes) {
  const touched = settingsContract.SETTING_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(changes, key),
  );
  if (!touched) return;

  if (changes.blockedKeywords) {
    savedSettings.blockedKeywords = settingsContract.normalizeList(changes.blockedKeywords.newValue);
  }
  if (changes.blockedChannels) {
    savedSettings.blockedChannels = settingsContract.normalizeList(changes.blockedChannels.newValue);
  }
  if (changes.selectedChannels) {
    savedSettings.selectedChannels = settingsContract.normalizeSelectedList(changes.selectedChannels.newValue) ?? [];
  }
  if (changes.allowedChannels) {
    savedSettings.allowedChannels = settingsContract.normalizeAllowedList(changes.allowedChannels.newValue);
  }
  if (changes.hideOldVideos) savedSettings.hideOldVideos = changes.hideOldVideos.newValue !== false;
  if (changes.hideGamesAndAds) savedSettings.hideGamesAndAds = changes.hideGamesAndAds.newValue !== false;
  if (changes.blockKeywords) savedSettings.blockKeywords = changes.blockKeywords.newValue === true;
  if (changes.maxAgeHours) {
    const maxAgeHours = Number(changes.maxAgeHours.newValue);
    if (settingsContract.isValidMaxAgeHours(maxAgeHours)) {
      savedSettings.maxAgeHours = maxAgeHours;
    }
  }
  if (changes.channelMode) {
    const channelMode = changes.channelMode.newValue;
    if (settingsContract.isValidChannelMode(channelMode)) savedSettings.channelMode = channelMode;
  }

  updateSettingsControls();
}

/**
 * Liga os controles ao contrato: os limites e o padrão da idade vêm de um só
 * lugar, e os campos de lista usam o mesmo teto que a gravação aceita.
 */
function applySettingsContract() {
  document.getElementById('maxAge').step = '1';
  updateAgeControls();

  const { min, max } = settingsContract.LIMITS.maxAgeHours;
  const hint = document.getElementById('ageHint');
  if (hint) hint.textContent = `De ${formatAge(min)} a ${formatAge(max)}.`;

  const maxLength = settingsContract.LIMITS.maxItemLength;
  for (const id of ['keywordInput', 'channelInput', 'allowInput', 'selectedInput']) {
    const input = document.getElementById(id);
    if (input) input.maxLength = maxLength;
  }
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
    document.getElementById('maxAge'),
    document.getElementById('maxAgeUnit'),
    document.getElementById('blockKeywords'),
    document.getElementById('channelMode'),
    document.getElementById('selectedInput'),
    document.getElementById('addSelected'),
  ];
  controls.forEach((control) => {
    control.disabled = true;
  });

  try {
    const status = await sendMessage({ action: 'status' });
    if (status.action !== 'status' || !status.settings) {
      throw new Error('Não foi possível carregar as preferências do filtro.');
    }
    savedSettings = settingsContract.normalizeSettings(status.settings);
    updateSettingsControls();
  } catch (error) {
    savedSettings = settingsContract.normalizeSettings({});
    updateSettingsControls();
    displayMessage('filterMessage', error.message, true);
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
    renderChannelMode();
  }
}

function updateSettingsControls() {
  document.getElementById('hideOldVideos').checked = savedSettings.hideOldVideos;
  document.getElementById('hideGamesAndAds').checked = savedSettings.hideGamesAndAds;
  updateAgeControls();
  document.getElementById('blockKeywords').checked = savedSettings.blockKeywords;
  renderKeywordList();
  renderChannelList();
  renderSelectedChannels();
  renderAllowedChannels();
  renderChannelMode();
}

/** A idade viaja em horas; a tela mostra dias quando a conta é exata. */
function updateAgeControls() {
  const hours = savedSettings.maxAgeHours;
  const unit = hours % settingsContract.HOURS_PER_DAY === 0 ? 'days' : 'hours';
  const input = document.getElementById('maxAge');
  const select = document.getElementById('maxAgeUnit');

  displayedAgeUnit = unit;
  select.value = unit;
  input.value = String(hours / ageUnitFactor(unit));
  applyAgeInputLimits(unit);
}

function applyAgeInputLimits(unit) {
  const { min, max } = settingsContract.LIMITS.maxAgeHours;
  const factor = ageUnitFactor(unit);
  const input = document.getElementById('maxAge');
  input.min = String(Math.ceil(min / factor));
  input.max = String(Math.floor(max / factor));
}

function ageUnitFactor(unit) {
  return unit === 'days' ? settingsContract.HOURS_PER_DAY : 1;
}

/** "3 dias", "6 horas": a mesma forma do card, com singular e plural. */
function formatAge(hours) {
  if (hours % settingsContract.HOURS_PER_DAY === 0) {
    const days = hours / settingsContract.HOURS_PER_DAY;
    return `${days} ${days === 1 ? 'dia' : 'dias'}`;
  }
  return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
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

/**
 * Trocar a unidade não muda o limite: o valor na tela é convertido para a
 * outra unidade. Quando as horas não fecham em dias inteiros, a troca é
 * recusada para não arredondar a escolha do usuário.
 */
function handleMaxAgeUnitChange() {
  const input = document.getElementById('maxAge');
  const select = document.getElementById('maxAgeUnit');
  const value = Number(input.value);
  const nextUnit = select.value;
  const hours = value * ageUnitFactor(displayedAgeUnit);

  if (!Number.isInteger(value) || value <= 0) {
    updateAgeControls();
    return;
  }

  if (nextUnit === 'days' && hours % settingsContract.HOURS_PER_DAY !== 0) {
    select.value = displayedAgeUnit;
    displayMessage('filterMessage', 'Use horas para limites que não fecham em dias inteiros.', true);
    return;
  }

  displayedAgeUnit = nextUnit;
  applyAgeInputLimits(nextUnit);
  input.value = String(hours / ageUnitFactor(nextUnit));
}

async function handleMaxAgeChange() {
  const input = document.getElementById('maxAge');
  const select = document.getElementById('maxAgeUnit');
  const value = Number(input.value);
  const hours = value * ageUnitFactor(select.value);

  if (!Number.isInteger(value) || value <= 0 || !settingsContract.isValidMaxAgeHours(hours)) {
    const { min, max } = settingsContract.LIMITS.maxAgeHours;
    updateAgeControls();
    displayMessage(
      'filterMessage',
      `Escolha um número inteiro entre ${formatAge(min)} e ${formatAge(max)}.`,
      true,
    );
    return;
  }

  const previousValue = savedSettings.maxAgeHours;
  input.disabled = true;
  select.disabled = true;
  try {
    const response = await sendMessage({ action: 'saveSettings', patch: { maxAgeHours: hours } });
    if (response.action !== 'saveSettings' || response.ok !== true) {
      throw new Error('Não foi possível salvar esta preferência.');
    }

    savedSettings = settingsContract.normalizeSettings(response.settings);
    updateAgeControls();
    displayMessage('filterMessage', `Limite salvo: ${formatAge(hours)}.`, false);
  } catch (error) {
    savedSettings.maxAgeHours = previousValue;
    updateAgeControls();
    displayMessage('filterMessage', error.message, true);
  } finally {
    input.disabled = false;
    select.disabled = false;
  }
}

async function handleBlockKeywords() {
  const control = document.getElementById('blockKeywords');
  const checked = control.checked;
  const message = checked
    ? 'Palavras-chave e canais serão bloqueados nos títulos e canais dos vídeos.'
    : 'Bloqueio por palavras-chave e canais desativado.';
  await persistSetting('blockKeywords', checked, control, message);
}

/* ------------------------------------------------------ modo só inscrições */

function renderChannelMode() {
  const active = savedSettings.channelMode !== 'off';
  const source = active ? savedSettings.channelMode : 'subscribed';

  document.getElementById('channelMode').checked = active;
  document.getElementById('channelSourceSelected').checked = source === 'selected';
  document.getElementById('channelSourceSubscribed').checked = source === 'subscribed';
  document.getElementById('channelModeSourceField').disabled = !active;
  document.getElementById('channelSourceSelected').disabled = !active;
  document.getElementById('channelSourceSubscribed').disabled = !active;
  document.getElementById('selectedChannelsPanel').hidden = !(active && source === 'selected');
  updateModeHint();
}

function updateModeHint() {
  const hint = document.getElementById('modeHint');
  if (!hint) return;

  if (savedSettings.channelMode === 'subscribed') {
    hint.textContent =
      channelCatalog.length === 0
        ? 'Nenhum canal inscrito coletado ainda. Abra a página de inscrições para guardar a lista; até lá o filtro não restringe por canal.'
        : `${channelCatalog.length} canais inscritos coletados. Só eles aparecem no feed.`;
    return;
  }

  if (savedSettings.channelMode === 'selected') {
    const count = savedSettings.selectedChannels.length;
    hint.textContent =
      count === 0
        ? 'Nenhum canal selecionado. Adicione um abaixo; até lá o filtro não restringe por canal.'
        : `${count} ${count === 1 ? 'canal selecionado' : 'canais selecionados'} no feed.`;
    return;
  }

  hint.textContent = 'Desligado: os filtros de idade, jogos/anúncios e palavras-chave continuam valendo normalmente.';
}

async function handleChannelMode() {
  const control = document.getElementById('channelMode');
  const mode = control.checked ? 'subscribed' : 'off';
  const message = mode === 'off' ? 'Modo só inscrições desativado.' : 'Modo só inscrições ativado: todas as inscrições.';
  await persistChannelMode(mode, message);
}

async function handleChannelModeSource() {
  const mode = document.getElementById('channelSourceSelected').checked ? 'selected' : 'subscribed';
  if (savedSettings.channelMode === mode) return;
  const message = mode === 'selected' ? 'Fonte: só os canais selecionados.' : 'Fonte: todos os canais inscritos.';
  await persistChannelMode(mode, message);
}

function setChannelModeBusy(busy) {
  document.getElementById('channelMode').disabled = busy;
  document.getElementById('selectedInput').disabled = busy;
  document.getElementById('addSelected').disabled = busy;
  document.getElementById('channelSourceSelected').disabled = busy || savedSettings.channelMode === 'off';
  document.getElementById('channelSourceSubscribed').disabled = busy || savedSettings.channelMode === 'off';
}

async function persistChannelMode(mode, successMessage) {
  const previous = savedSettings.channelMode;
  setChannelModeBusy(true);
  try {
    const response = await sendMessage({ action: 'saveSettings', patch: { channelMode: mode } });
    if (response.action !== 'saveSettings' || response.ok !== true) {
      throw new Error('Não foi possível salvar o modo.');
    }
    savedSettings = settingsContract.normalizeSettings(response.settings);
    updateSettingsControls();
    displayMessage('modeMessage', successMessage, false);
  } catch (error) {
    savedSettings.channelMode = previous;
    updateSettingsControls();
    displayMessage('modeMessage', error.message, true);
  } finally {
    setChannelModeBusy(false);
    renderChannelMode();
  }
}

function renderSelectedChannels() {
  const values = Array.isArray(savedSettings.selectedChannels) ? savedSettings.selectedChannels : [];
  const container = document.getElementById('selectedBadges');
  container.innerHTML = '';
  values.forEach((entry) => container.appendChild(createSelectedBadge(entry)));

  document.getElementById('selectedCount').textContent = String(values.length);
  document.getElementById('selectedEmpty').hidden = values.length > 0;
}

function createSelectedBadge(entry) {
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
    const current = Array.isArray(savedSettings.selectedChannels) ? savedSettings.selectedChannels : [];
    await persistSelected(
      current.filter((item) => !channelRules.sameChannel(item, entry)),
      `${entry.name} removido dos canais selecionados.`,
    );
  });
  badge.appendChild(removeButton);
  return badge;
}

function renderSelectedSuggestions() {
  const query = normalizeChannelText(document.getElementById('selectedInput').value);
  const container = document.getElementById('selectedSuggestions');
  selectedMatches = query === '' ? [] : searchCatalog(query);
  container.innerHTML = '';
  container.hidden = selectedMatches.length === 0;
  selectedMatches.forEach((entry) => container.appendChild(createSuggestion(entry, addSelectedChannel)));
}

async function handleAddSelected(event) {
  event.preventDefault();
  if (selectedMatches.length === 0) renderSelectedSuggestions();
  if (selectedMatches.length === 0) {
    displayMessage('modeMessage', 'Nenhum canal encontrado nas suas inscrições com esse nome.', true);
    return;
  }
  await addSelectedChannel(selectedMatches[0]);
}

async function addSelectedChannel(entry) {
  const current = Array.isArray(savedSettings.selectedChannels) ? savedSettings.selectedChannels : [];
  if (current.some((item) => channelRules.sameChannel(item, entry))) {
    displayMessage('modeMessage', `“${entry.name}” já está na lista.`, true);
    return;
  }

  const next = [...current, { name: entry.name, handle: entry.handle || '' }];
  const saved = await persistSelected(next, `${entry.name} sempre aparecerá no modo.`);
  if (saved) {
    document.getElementById('selectedInput').value = '';
    renderSelectedSuggestions();
  }
}

async function persistSelected(nextValues, successMessage) {
  try {
    const response = await sendMessage({ action: 'saveSettings', patch: { selectedChannels: nextValues } });
    if (response.action !== 'saveSettings' || response.ok !== true) {
      throw new Error('Não foi possível salvar a lista.');
    }
    savedSettings = settingsContract.normalizeSettings(response.settings);
    renderSelectedChannels();
    renderChannelMode();
    displayMessage('modeMessage', successMessage, false);
    return true;
  } catch (error) {
    renderSelectedChannels();
    displayMessage('modeMessage', error.message, true);
    return false;
  }
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
    savedSettings = settingsContract.normalizeSettings(response.settings);
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

    savedSettings = settingsContract.normalizeSettings(response.settings);
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
    updateModeHint();
  } catch (error) {
    channelCatalog = [];
    displayMessage('allowMessage', error.message, true);
    updateModeHint();
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
  allowMatches.forEach((entry) => container.appendChild(createSuggestion(entry, addAllowedChannel)));
}

function createSuggestion(entry, onPick) {
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
    await onPick(entry);
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
    savedSettings = settingsContract.normalizeSettings(response.settings);
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
