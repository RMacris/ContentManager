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
  document.getElementById('flushNow').addEventListener('click', handleFlushNow);
  document.getElementById('collectSubscriptions').addEventListener('click', handleCollectSubscriptions);
  document.getElementById('hideOldVideos').addEventListener('change', handleHideOldVideos);
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

/** Como o popup chama cada gatilho da colheita. */
const TRIGGER_LABELS = { alarme: 'automática', manual: 'manual', retentativa: 'retentativa' };

/** O motivo da parada na coleta de inscrições, em português. */
const STOP_REASON_LABELS = {
  cap: 'teto de canais',
  'time-budget': 'tempo da rodada esgotado',
  'page-limit': 'muitas páginas seguidas',
  loop: 'a página repetiu o token',
  'fetch-failed': 'um pedido de continuação falhou',
  'bootstrap-failed': 'a consulta de fecho falhou',
  'bootstrap-unrecognized': 'a resposta de fecho não tinha grade reconhecível',
  'stale-continuation': 'a continuação não devolveu canal nenhum',
  'missing-config': 'a página não expôs a chave do YouTube',
};

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
  document.getElementById('hideOldVideos').checked = status.settings.hideOldVideos !== false;

  const lines = [];
  lines.push(status.bridge.ok ? 'ponte: respondendo' : `ponte: sem resposta — ${status.bridge.detail}`);

  const delivery = status.delivery;
  if (delivery.lastDelivery) {
    const when = new Date(delivery.lastDelivery.at).toLocaleString();
    lines.push(
      delivery.lastDelivery.ok
        ? `última entrega: entregue em ${when}`
        : `última entrega: falhou em ${when} — ${deliveryDetail(delivery.lastDelivery.detail)}`,
    );
  }

  const run = status.lastRun;
  if (run) {
    const when = new Date(run.at).toLocaleString();
    const trigger = TRIGGER_LABELS[run.trigger] ?? run.trigger ?? '';
    if (run.deliveryRetry) {
      lines.push(`última rodada: ${when} (${trigger}) — reenvio de pendentes ${run.ok ? 'entregue' : 'falhou'}`);
      if (!run.ok) lines.push(`motivo: ${deliveryDetail(run.delivery)}`);
    } else if (run.ok) {
      lines.push(`última colheita: ${when} (${trigger}) — ${run.cardCount} cards, ${run.delivery}`);
    } else {
      lines.push(`última colheita: ${when} (${trigger}) — falhou`);
      // `error` vem de uma falha na coleta; `delivery` vem de uma colheita que deu
      // certo mas não chegou à ponte. `harvestOk`/`deliveryOk` dizem qual dos dois
      // foi, e o detalhe da entrega já chega em português do bridge-client.
      const reason =
        run.harvestOk === false
          ? run.error ?? 'sem detalhe'
          : deliveryDetail(run.delivery ?? run.error);
      lines.push(`motivo: ${reason}`);
      if (typeof run.cardCount === 'number' && run.cardCount > 0) {
        lines.push(`(a colheita funcionou: ${run.cardCount} cards — só a entrega falhou)`);
      }
    }
  } else {
    lines.push('nenhuma colheita ainda');
  }

  lines.push(
    delivery.queueLength > 0
      ? `fila pendente: ${delivery.queueLength} lote(s) — use "Enviar pendentes agora"`
      : 'fila: nenhum lote pendente',
  );

  document.getElementById('flushNow').disabled = delivery.queueLength === 0;

  setText('collectStatus', lines.join('\n'));
  renderSubscriptionsStatus(status.lastSubscriptionsRun);
}

/** O detalhe da entrega em português; resumos antigos guardaram o erro cru do `fetch`. */
function deliveryDetail(detail) {
  if (typeof detail !== 'string' || detail === '') return 'sem detalhe';
  if (detail.includes('Failed to fetch')) return 'sem conexão com a ponte';
  return detail;
}

/** A linha das inscrições: a última coleta, com o que ela trouxe ou por que falhou. */
function renderSubscriptionsStatus(run) {
  const lines = [];
  if (!run) {
    lines.push('nenhuma coleta de inscrições ainda');
  } else {
    const when = new Date(run.at).toLocaleString();
    if (run.ok) {
      lines.push(`${run.channelCount} canais coletados em ${when}`);
      if (typeof run.pages === 'number' && run.pages > 0) {
        lines.push(`percorreu ${run.pages} continuaç${run.pages === 1 ? 'ão' : 'ões'} da lista`);
      }
      if (run.hasMore) {
        const why = STOP_REASON_LABELS[run.stopReason] ?? run.stopReason ?? 'motivo não declarado';
        lines.push(`a coleta parou antes do fim (${why}) — a lista pode estar parcial`);
      }
    } else {
      lines.push(`última coleta de inscrições falhou em ${when}`);
      lines.push(`motivo: ${run.error ?? run.delivery ?? 'sem detalhe'}`);
    }
    if (run.tabClosed === false) lines.push('atenção: a aba da coleta não pôde ser fechada');
  }
  setText('subscriptionsStatus', lines.join('\n'));
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

/**
 * O filtro de idade vale na hora: a mudança é a própria preferência, e o
 * content script de cada aba do YouTube escuta o `storage`.
 */
async function handleHideOldVideos() {
  const checked = document.getElementById('hideOldVideos').checked;
  await chrome.runtime.sendMessage({ action: 'saveSettings', patch: { hideOldVideos: checked } });
  displayMessage('filterMessage', checked ? 'Filtro ativado.' : 'Filtro desativado.', false);
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
    const reason =
      summary.harvestOk === false
        ? summary.error ?? 'sem detalhe'
        : deliveryDetail(summary.delivery ?? summary.error);
    displayMessage('collectMessage', `Falhou: ${reason}`, true);
  }
  loadStatus();
}

/** O reenvio manual: esvazia a fila pendente sem colher de novo. */
async function handleFlushNow() {
  const button = document.getElementById('flushNow');
  button.disabled = true;
  displayMessage('collectMessage', 'Enviando pendentes…', false);

  const response = await chrome.runtime.sendMessage({ action: 'flushNow' });
  const delivery = response && response.delivery;

  if (!response) {
    displayMessage('collectMessage', 'A extensão não respondeu ao reenvio.', true);
  } else if (!delivery) {
    displayMessage('collectMessage', 'Não havia lote pendente para enviar.', false);
  } else if (delivery.ok) {
    displayMessage('collectMessage', 'Pendentes entregues à ponte.', false);
  } else {
    displayMessage('collectMessage', `A entrega falhou: ${deliveryDetail(delivery.detail)}`, true);
  }
  loadStatus();
}

async function handleCollectSubscriptions() {
  displayMessage('subscriptionsMessage', 'Coletando inscrições…', false);
  const response = await chrome.runtime.sendMessage({ action: 'collectSubscriptions' });
  const summary = response && response.summary;

  if (!summary) {
    displayMessage('subscriptionsMessage', 'A coleta não devolveu resultado.', true);
    return;
  }
  if (summary.ok) {
    const partial = summary.hasMore ? ' A lista pode estar parcial.' : '';
    displayMessage('subscriptionsMessage', `Inscrições entregues: ${summary.channelCount} canais.${partial}`, false);
  } else {
    displayMessage('subscriptionsMessage', `Falhou: ${summary.error || summary.delivery}`, true);
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
