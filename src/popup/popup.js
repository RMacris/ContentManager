/**
 * Popup: bloqueio de URLs (como antes) e configuração da coleta (novo).
 *
 * Script clássico — o popup não carrega módulos ES. Toda a lógica de verdade
 * vive no service worker; aqui só há formulário e apresentação.
 */
document.addEventListener('DOMContentLoaded', () => {
  initialize();
});

function initialize() {
  document.getElementById('blockUrl').addEventListener('click', handleBlockUrl);
  document.getElementById('saveSettings').addEventListener('click', handleSaveSettings);
  document.getElementById('collectNow').addEventListener('click', handleCollectNow);
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

/* -------------------------------------------------------------------- coleta */

async function loadStatus() {
  const status = await chrome.runtime.sendMessage({ action: 'status' });
  if (!status || status.action !== 'status') {
    setText('collectStatus', 'não foi possível ler o estado da extensão');
    return;
  }

  document.getElementById('collectEnabled').checked = status.settings.collectEnabled;
  document.getElementById('collectPeriodMinutes').value = status.settings.collectPeriodMinutes;
  document.getElementById('bridgeUrl').value = status.settings.bridgeUrl;
  document.getElementById('bridgeToken').value = status.settings.bridgeToken;

  const lines = [];
  lines.push(status.bridge.ok ? 'ponte: respondendo' : `ponte: sem resposta (${status.bridge.detail})`);

  const run = status.lastRun;
  if (run) {
    const when = new Date(run.at).toLocaleString();
    if (run.ok) {
      lines.push(`última colheita: ${when} — ${run.cardCount} cards, ${run.delivery}`);
      if (run.reusedTab) lines.push('reaproveitou uma aba do YouTube já aberta');
      if (run.maximized === false) lines.push(`não maximizou (${run.maximizeReason}) — rolou três telas`);
    } else {
      lines.push(`última colheita: ${when} — falhou`);
      // `error` vem de uma falha na coleta; `delivery` vem de uma colheita que deu
      // certo mas não chegou à ponte. Ler só `error` mostrava "motivo: undefined"
      // exatamente no caso mais comum — token ainda não configurado.
      lines.push(`motivo: ${run.error ?? run.delivery ?? 'sem detalhe'}`);
      if (typeof run.cardCount === 'number' && run.cardCount > 0) {
        lines.push(`(a colheita funcionou: ${run.cardCount} cards — só a entrega falhou)`);
      }
    }
  } else {
    lines.push('nenhuma colheita ainda');
  }

  if (status.delivery.queueLength > 0) {
    lines.push(`fila pendente: ${status.delivery.queueLength} lote(s)`);
  }

  setText('collectStatus', lines.join('\n'));
}

async function handleSaveSettings() {
  const patch = {
    collectEnabled: document.getElementById('collectEnabled').checked,
    collectPeriodMinutes: Number(document.getElementById('collectPeriodMinutes').value) || 60,
    bridgeUrl: document.getElementById('bridgeUrl').value.trim(),
    bridgeToken: document.getElementById('bridgeToken').value.trim(),
  };
  await chrome.runtime.sendMessage({ action: 'saveSettings', patch });
  displayMessage('collectMessage', 'Configurações salvas.', false);
  loadStatus();
}

async function handleCollectNow() {
  displayMessage('collectMessage', 'Colhendo…', false);
  const response = await chrome.runtime.sendMessage({ action: 'collectNow' });
  const summary = response && response.summary;

  if (!summary) {
    displayMessage('collectMessage', 'A colheita não devolveu resultado.', true);
    return;
  }
  if (summary.ok) {
    displayMessage('collectMessage', `Colheita entregue: ${summary.cardCount} cards.`, false);
  } else {
    displayMessage('collectMessage', `Falhou: ${summary.error || summary.delivery}`, true);
  }
  loadStatus();
}

/* ------------------------------------------------------------------ utilidades */

function displayMessage(elementId, text, isError) {
  const element = document.getElementById(elementId);
  element.innerText = text;
  element.className = `message ${isError ? 'error' : 'ok'}`;
  element.style.display = 'block';
}

function setText(elementId, text) {
  document.getElementById(elementId).textContent = text;
}
