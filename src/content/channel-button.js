/**
 * Botão de bloqueio ao lado do nome do canal no YouTube.
 *
 * Injeta um chip discreto junto ao nome do canal — no dono do vídeo, no
 * cabeçalho do canal e nos cards (aí só no hover) — que adiciona ou remove o
 * canal de `blockedChannels` sem abrir o popup. A lista é a mesma do filtro:
 * com o interruptor ligado, os cards do canal somem na hora.
 *
 * Script clássico (sem import/export), como os outros content scripts. Não
 * fala com a rede; a única escrita é a mensagem para o service worker salvar
 * a lista no chrome.storage. Canais da allowlist não ganham o botão: eles
 * nunca são filtrados, então bloquear ali seria uma promessa falsa.
 *
 * A leitura do DOM — onde o nome do canal aparece, o handle e o ponto de
 * montagem — mora em `youtube-dom.js`. Aqui ficam só o desenho e o clique.
 */
(function () {
  'use strict';

  // As regras de lista vêm de `channel-rules.js`, carregado antes deste
  // arquivo. Sem elas não há como decidir allowlist nem blocklist.
  const channelRules = typeof globalThis !== 'undefined' ? globalThis.YTIChannelRules : null;
  if (channelRules === null || channelRules === undefined) return;

  // A leitura do DOM do YouTube vem de `youtube-dom.js`, carregado antes deste
  // arquivo; o chip recebe o alvo lido e só se posiciona.
  const youtubeDom = typeof globalThis !== 'undefined' ? globalThis.YTIYouTubeDom : null;
  if (youtubeDom === null || youtubeDom === undefined) return;

  // O ciclo da página vem de `content-runtime.js`, carregado antes deste
  // arquivo; o chip só registra o próprio scan e a limpeza dos botões.
  const runtimeCore = typeof globalThis !== 'undefined' ? globalThis.YTIContentRuntime : null;
  if (runtimeCore === null || runtimeCore === undefined) return;

  // O feed único das preferências vem de `content-settings.js`, carregado
  // antes deste arquivo; o chip não lê o storage nem registra listener.
  const settingsFeed = typeof globalThis !== 'undefined' ? globalThis.YTIContentSettings : null;
  if (settingsFeed === null || settingsFeed === undefined) return;

  // Recarregar a extensão órfã o script antigo: o `chrome.runtime.id` dele
  // apaga. A guarda devolve falso e a reinjeção (chrome.scripting) revive a
  // aba sem refresh, do mesmo jeito que o filtro de idade.
  const running = globalThis.__ytiChannelButtonAlive;
  if (typeof running === 'function' && running()) return;
  globalThis.__ytiChannelButtonAlive = runtimeCore.isExtensionAlive;

  const HOST_CLASS = 'yti-channel-block-host';
  const STYLE_ID = 'yti-channel-block-style';
  const INSTANCE_ID = Math.random().toString(36).slice(2);
  const HOST_SELECTOR = '.' + HOST_CLASS;
  const INSTANCE_ATTRIBUTE = 'data-yti-instance';

  let blockedChannels = [];
  let allowedChannels = [];
  let started = false;
  let runtime = null;
  let saveQueue = Promise.resolve();
  let hostMap = new WeakMap();
  let buttonOf = new WeakMap();
  let labelOf = new WeakMap();
  let liveHosts = new Set();

  const PAGE_CSS = `
    .${HOST_CLASS} {
      --yti-cb-ink: #4c5fe3;
      --yti-cb-bg: rgb(76 95 227 / 8%);
      --yti-cb-bg-hover: rgb(76 95 227 / 16%);
      --yti-cb-line: rgb(76 95 227 / 38%);
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      margin-left: 6px;
      vertical-align: middle;
      line-height: 0;
    }
    html[dark] .${HOST_CLASS} {
      --yti-cb-ink: #aab4ff;
      --yti-cb-bg: rgb(170 180 255 / 10%);
      --yti-cb-bg-hover: rgb(170 180 255 / 18%);
      --yti-cb-line: rgb(170 180 255 / 38%);
    }
    .${HOST_CLASS}[data-blocked="true"] {
      --yti-cb-ink: #bb3e4b;
      --yti-cb-bg: rgb(187 62 75 / 10%);
      --yti-cb-bg-hover: rgb(187 62 75 / 18%);
      --yti-cb-line: rgb(187 62 75 / 42%);
    }
    html[dark] .${HOST_CLASS}[data-blocked="true"] {
      --yti-cb-ink: #ff9aa4;
      --yti-cb-bg: rgb(255 154 164 / 12%);
      --yti-cb-bg-hover: rgb(255 154 164 / 20%);
      --yti-cb-line: rgb(255 154 164 / 42%);
    }
    .${HOST_CLASS}[data-surface="card"] {
      opacity: 0;
      pointer-events: none;
      transition: opacity .12s ease;
    }
    @media (hover: hover) {
      ytd-video-renderer:hover .${HOST_CLASS}[data-surface="card"],
      ytd-rich-item-renderer:hover .${HOST_CLASS}[data-surface="card"],
      ytd-grid-video-renderer:hover .${HOST_CLASS}[data-surface="card"],
      ytd-compact-video-renderer:hover .${HOST_CLASS}[data-surface="card"],
      ytd-playlist-video-renderer:hover .${HOST_CLASS}[data-surface="card"],
      ytd-playlist-panel-video-renderer:hover .${HOST_CLASS}[data-surface="card"],
      ytd-reel-item-renderer:hover .${HOST_CLASS}[data-surface="card"],
      yt-lockup-view-model:hover .${HOST_CLASS}[data-surface="card"],
      .${HOST_CLASS}[data-surface="card"]:focus-within {
        opacity: 1;
        pointer-events: auto;
      }
    }
    @media (hover: none) {
      .${HOST_CLASS}[data-surface="card"] { opacity: 1; pointer-events: auto; }
    }
    .${HOST_CLASS}[data-pending="true"] { opacity: .65; }
  `;

  const SHADOW_MARKUP = `
    <style>
      :host { display: inline-flex; }
      button {
        all: unset;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        height: 24px;
        padding: 0 9px;
        border: 1px solid var(--yti-cb-line, rgb(76 95 227 / 38%));
        border-radius: 999px;
        background: var(--yti-cb-bg, rgb(76 95 227 / 8%));
        color: var(--yti-cb-ink, #4c5fe3);
        font: 600 11px/1 Roboto, Arial, sans-serif;
        cursor: pointer;
        white-space: nowrap;
        transition: background .15s ease, border-color .15s ease, transform .1s ease;
      }
      button:hover {
        border-color: var(--yti-cb-ink, #4c5fe3);
        background: var(--yti-cb-bg-hover, rgb(76 95 227 / 16%));
      }
      button:active { transform: translateY(1px); }
      button:focus-visible { outline: 2px solid var(--yti-cb-ink, #4c5fe3); outline-offset: 2px; }
      button:disabled { cursor: wait; opacity: .65; }
      svg { width: 12px; height: 12px; flex: 0 0 auto; }
      :host([data-surface="card"]) button { width: 22px; height: 22px; padding: 0; }
      :host([data-surface="card"]) .label { display: none; }
    </style>
    <button type="button">
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <path d="M4.3 11.7 11.7 4.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span class="label"></span>
    </button>
  `;

  /* --------------------------------------------------------------- utilidades */

  /** API de depuração; toda a política de lista mora em `channel-rules.js`. */
  globalThis.YTIChannelButton = {
    cleanText: channelRules.cleanText,
    normalizeName: channelRules.normalizeChannelName,
    isBlocked: (name) => channelRules.isBlockedChannel(name, blockedChannels),
    nextBlockedChannels: (name) => channelRules.nextBlockedChannels(name, blockedChannels),
  };

  /* --------------------------------------------------------- estado e desenho */

  function setBlockedChannels(values) {
    blockedChannels = values;
    refreshHosts();
  }

  function setAllowedChannels(values) {
    allowedChannels = values;
    refreshHosts();
    scheduleScan();
  }

  function refreshHosts() {
    for (const host of Array.from(liveHosts)) {
      if (!host.isConnected) {
        liveHosts.delete(host);
        continue;
      }
      const name = channelRules.cleanText(host.getAttribute('data-channel'));
      const handle = host.getAttribute('data-handle') || '';
      if (name === '' || channelRules.isAllowedChannel(name, handle, allowedChannels)) {
        host.remove();
        liveHosts.delete(host);
        continue;
      }
      updateHost(host, name, handle, host.getAttribute('data-surface') || 'card');
    }
  }

  function setPending(host, pending) {
    host.setAttribute('data-pending', pending ? 'true' : 'false');
    const button = buttonOf.get(host);
    if (button !== undefined) button.disabled = pending;
  }

  function updateHost(host, name, handle, surface) {
    host.setAttribute('data-channel', name);
    host.setAttribute('data-surface', surface);
    if (handle === '') host.removeAttribute('data-handle');
    else host.setAttribute('data-handle', handle);

    const blocked = channelRules.isBlockedChannel(name, blockedChannels);
    host.setAttribute('data-blocked', blocked ? 'true' : 'false');

    const action = blocked ? 'Desbloquear' : 'Bloquear';
    const description = `${action} ${name}`;
    const button = buttonOf.get(host);
    if (button !== undefined) {
      button.setAttribute('title', description);
      button.setAttribute('aria-label', description);
      if (!host.hasAttribute('data-pending') || host.getAttribute('data-pending') !== 'true') {
        button.disabled = false;
      }
    }

    const label = labelOf.get(host);
    if (label !== undefined) {
      label.textContent = surface === 'card' ? '' : (blocked ? 'Desbloquear' : 'Bloquear');
    }
  }

  function createHost(name, handle, surface) {
    const host = document.createElement('span');
    host.className = HOST_CLASS;
    host.setAttribute(INSTANCE_ATTRIBUTE, INSTANCE_ID);
    host.setAttribute('data-pending', 'false');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = SHADOW_MARKUP;

    const button = shadow.querySelector('button');
    const label = shadow.querySelector('.label');
    if (button !== null) {
      button.addEventListener('click', (event) => {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        enqueueToggle(host);
      });
      buttonOf.set(host, button);
    }
    if (label !== null) labelOf.set(host, label);

    liveHosts.add(host);
    updateHost(host, name, handle, surface);
    return host;
  }

  function ensureHost(key, name, handle, surface, append) {
    if (channelRules.isAllowedChannel(name, handle, allowedChannels)) {
      const allowedHost = hostMap.get(key);
      if (allowedHost !== undefined) {
        allowedHost.remove();
        liveHosts.delete(allowedHost);
      }
      hostMap.delete(key);
      return null;
    }

    let host = hostMap.get(key);
    if (host !== undefined && !host.isConnected) host = undefined;
    if (host === undefined) {
      host = createHost(name, handle, surface);
      hostMap.set(key, host);
    } else {
      updateHost(host, name, handle, surface);
    }
    append(host);
    return host;
  }

  /* ---------------------------------------------------------------- injeção */

  function injectStyle() {
    if (document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute(INSTANCE_ATTRIBUTE, INSTANCE_ID);
    style.textContent = PAGE_CSS;
    const parent = document.head || document.documentElement;
    if (parent !== null && parent !== undefined) parent.appendChild(style);
  }

  /** Põe o chip no ponto que a leitura indicou. */
  function placeHost(host, target) {
    if (target.parent === null || target.parent === undefined) return;
    if (target.after === null) {
      if (host.parentNode !== target.parent) target.parent.appendChild(host);
      return;
    }
    if (host.parentNode === target.parent && host.previousElementSibling === target.after) return;
    target.parent.insertBefore(host, target.after.nextSibling);
  }

  function scanClassicContainers() {
    const containers = document.querySelectorAll(youtubeDom.selectors.channelContainer);
    for (let i = 0; i < containers.length; i += 1) {
      const target = youtubeDom.readChannelTarget(containers[i], { kind: 'classic' });
      if (target === null) continue;
      ensureHost(target.key, target.name, target.handle, target.surface, (host) => placeHost(host, target));
    }
  }

  function scanLockups() {
    const lockups = document.querySelectorAll(youtubeDom.selectors.lockup);
    for (let i = 0; i < lockups.length; i += 1) {
      const target = youtubeDom.readChannelTarget(lockups[i], { kind: 'lockup' });
      if (target === null) continue;
      ensureHost(target.key, target.name, target.handle, target.surface, (host) => placeHost(host, target));
    }
  }

  function scanPageHeader() {
    const titles = document.querySelectorAll(youtubeDom.selectors.pageHeaderTitle);
    const pathname = String(location.pathname || '');
    for (let i = 0; i < titles.length; i += 1) {
      const target = youtubeDom.readChannelTarget(titles[i], { kind: 'page', pathname });
      if (target === null) continue;
      ensureHost(target.key, target.name, target.handle, target.surface, (host) => placeHost(host, target));
    }
  }

  function scan() {
    injectStyle();
    scanClassicContainers();
    scanLockups();
    scanPageHeader();
  }

  function shouldScan() {
    return true;
  }

  /* ------------------------------------------------------------------ ciclo */

  /** Agenda a varredura deste adaptador pelo runtime compartilhado. */
  function scheduleScan() {
    if (runtime !== null) runtime.schedule();
  }

  function removeOwnArtifacts() {
    const hosts = document.querySelectorAll(HOST_SELECTOR);
    for (let i = 0; i < hosts.length; i += 1) {
      if (hosts[i].getAttribute(INSTANCE_ATTRIBUTE) === INSTANCE_ID) hosts[i].remove();
    }
    const style = document.getElementById(STYLE_ID);
    if (style !== null && style.getAttribute(INSTANCE_ATTRIBUTE) === INSTANCE_ID) style.remove();
  }

  function removeOldArtifacts() {
    const hosts = document.querySelectorAll(HOST_SELECTOR);
    for (let i = 0; i < hosts.length; i += 1) hosts[i].remove();
    const style = document.getElementById(STYLE_ID);
    if (style !== null) style.remove();
  }

  /* ------------------------------------------------------------------ clique */

  function enqueueToggle(host) {
    saveQueue = saveQueue.then(() => toggleChannel(host)).catch(() => {});
  }

  async function toggleChannel(host) {
    if (!host.isConnected) return;
    if (host.getAttribute('data-pending') === 'true') return;

    const name = channelRules.cleanText(host.getAttribute('data-channel'));
    if (name === '') return;
    const handle = host.getAttribute('data-handle') || '';
    const surface = host.getAttribute('data-surface') || 'card';
    const previous = blockedChannels;
    const next = channelRules.nextBlockedChannels(name, blockedChannels);

    setPending(host, true);
    // A troca do chip acompanha o clique; o salvamento só confirma ou desfaz.
    setBlockedChannels(next);
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'saveSettings',
        patch: { blockedChannels: next },
      });
      if (response === null || response === undefined || response.action !== 'saveSettings' || response.ok !== true) {
        throw new Error('Não foi possível salvar o canal bloqueado.');
      }
      const saved = response.settings && response.settings.blockedChannels;
      setBlockedChannels(Array.isArray(saved) ? saved : next);
    } catch (error) {
      setBlockedChannels(previous);
      if (!runtimeCore.isExtensionAlive()) {
        if (runtime !== null) runtime.stop();
        return;
      }
      host.setAttribute('data-error', 'true');
      setTimeout(() => {
        if (host.isConnected) host.removeAttribute('data-error');
      }, 2500);
      console.warn('Could not save the blocked channel.', error);
    } finally {
      if (host.isConnected) {
        setPending(host, false);
        updateHost(host, name, handle, surface);
      }
    }
  }

  /* ---------------------------------------------------------------- settings */

  function applySettings(settings) {
    if (channelRules.allowedSignature(settings.allowedChannels) !== channelRules.allowedSignature(allowedChannels)) {
      setAllowedChannels(settings.allowedChannels);
    }
    if (!sameList(settings.blockedChannels, blockedChannels)) {
      setBlockedChannels(settings.blockedChannels);
    }
  }

  /** A lista já normalizada mudou? Evita redesenhar o chip a cada preferência. */
  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /* -------------------------------------------------------------------- start */

  function start() {
    if (started) return;
    started = true;

    removeOldArtifacts();
    injectStyle();
    settingsFeed.subscribe(applySettings);
    runtime = runtimeCore.register({
      scan,
      shouldScan,
      onStop: removeOwnArtifacts,
      // O chip mantém o piso de 250 ms entre varreduras agendadas.
      minScanIntervalMs: 250,
    });
  }

  start();
})();
