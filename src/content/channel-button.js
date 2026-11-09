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
 */
(function () {
  'use strict';

  // As regras de lista vêm de `channel-rules.js`, carregado antes deste
  // arquivo. Sem elas não há como decidir allowlist nem blocklist.
  const channelRules = typeof globalThis !== 'undefined' ? globalThis.YTIChannelRules : null;
  if (channelRules === null || channelRules === undefined) return;

  // Recarregar a extensão órfã o script antigo: o `chrome.runtime.id` dele
  // apaga. A guarda devolve falso e a reinjeção (chrome.scripting) revive a
  // aba sem refresh, do mesmo jeito que o filtro de idade.
  const running = globalThis.__ytiChannelButtonAlive;
  if (typeof running === 'function' && running()) return;
  globalThis.__ytiChannelButtonAlive = isExtensionAlive;

  const HOST_CLASS = 'yti-channel-block-host';
  const STYLE_ID = 'yti-channel-block-style';
  const INSTANCE_ID = Math.random().toString(36).slice(2);
  const HOST_SELECTOR = '.' + HOST_CLASS;
  const INSTANCE_ATTRIBUTE = 'data-yti-instance';

  /** O link do canal: o nome do dono, dos cards e do cabeçalho do canal. */
  const CHANNEL_LINK_SELECTOR = [
    'a[href^="/@"]',
    'a[href*="/channel/"]',
    'a[href*="/c/"]',
    'a[href*="/user/"]',
  ].join(',');

  /** Cards de vídeo: o botão compacto só aparece no hover. */
  const CARD_SELECTOR = [
    'ytd-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer',
    'ytd-rich-grid-media',
    'yt-lockup-view-model',
  ].join(',');

  /** Onde o nome grande do canal mora: dono do vídeo e cabeçalho do canal. */
  const HEADER_SELECTOR = [
    'ytd-video-owner-renderer',
    'ytd-watch-metadata #owner',
    'ytd-channel-header-renderer',
    'ytd-c4-tabbed-header-renderer',
    'yt-page-header-renderer',
    'ytd-reel-video-renderer',
    'ytd-reel-player-header-renderer',
    'ytd-shorts',
    '#channel-header',
  ].join(',');

  /** O título da página de canal, que o layout novo tirou do `ytd-channel-name`. */
  const PAGE_HEADER_TITLE_SELECTOR = 'yt-page-header-renderer h1';

  /** O lockup novo do YouTube: o nome do canal virou texto, não link. */
  const LOCKUP_SELECTOR = 'yt-lockup-view-model';
  const LOCKUP_ROW_SELECTOR = '.ytContentMetadataViewModelMetadataRow';
  const LOCKUP_NAME_SELECTOR = '.ytContentMetadataViewModelMetadataText';
  const LOCKUP_BADGE_SELECTOR = [
    '.ytIconWrapperHost',
    '.ytContentMetadataViewModelIcon',
    'ytd-badge-supported-renderer',
    'badge-shape',
  ].join(',');
  const LOCKUP_AVATAR_SELECTOR = '.ytLockupMetadataViewModelAvatar, yt-avatar-shape';

  let blockedChannels = [];
  let allowedChannels = [];
  let started = false;
  let stopped = false;
  let domWatched = false;
  let domObserver = null;
  let scanTimer = null;
  let sweepTimer = null;
  let lastScanAt = 0;
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

  function isExtensionAlive() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime) && Boolean(chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  function isVisible(node) {
    return Boolean(node) && typeof node.getClientRects === 'function' && node.getClientRects().length > 0;
  }

  /** API de depuração; toda a política de lista mora em `channel-rules.js`. */
  globalThis.YTIChannelButton = {
    cleanText: channelRules.cleanText,
    normalizeName: channelRules.normalizeChannelName,
    isBlocked: (name) => channelRules.isBlockedChannel(name, blockedChannels),
    nextBlockedChannels: (name) => channelRules.nextBlockedChannels(name, blockedChannels),
  };

  /* --------------------------------------------------------- estado e desenho */

  function setBlockedChannels(values) {
    blockedChannels = channelRules.normalizeList(values);
    refreshHosts();
  }

  function setAllowedChannels(values) {
    allowedChannels = channelRules.normalizeAllowed(values);
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

  function channelNameFrom(container, link) {
    const text = container.querySelector('#text');
    if (text !== null) {
      const value = channelRules.cleanText(text.textContent);
      if (value !== '') return value;
    }
    return channelRules.cleanText(link.textContent);
  }

  function wantsClassicContainer(container) {
    if (container.closest(CARD_SELECTOR) !== null) return true;
    if (container.closest(HEADER_SELECTOR) !== null) return true;
    return false;
  }

  function scanClassicContainers() {
    const containers = document.querySelectorAll('ytd-channel-name');
    for (let i = 0; i < containers.length; i += 1) {
      const container = containers[i];
      if (!isVisible(container) || !wantsClassicContainer(container)) continue;
      const link = container.querySelector(CHANNEL_LINK_SELECTOR);
      if (link === null) continue;
      const name = channelNameFrom(container, link);
      if (!channelRules.isUsableChannelName(name)) continue;
      const handle = channelRules.handleFromHref(link.getAttribute('href'));
      const surface = container.closest(CARD_SELECTOR) !== null ? 'card' : 'watch';
      ensureHost(container, name, handle, surface, (host) => {
        if (host.parentNode !== container) container.appendChild(host);
      });
    }
  }

  /**
   * O lockup novo não tem link no nome do canal. A primeira linha de metadados
   * é o nome; a linha de playlist ("YouTube Playlist") não tem badge, avatar
   * nem as partes de views/idade, então fica de fora.
   */
  function lockupTarget(lockup) {
    const row = lockup.querySelector(LOCKUP_ROW_SELECTOR);
    if (row === null || !isVisible(row)) return null;
    const nameNode = row.querySelector(LOCKUP_NAME_SELECTOR);
    if (nameNode === null) return null;

    const hasBadge = row.querySelector(LOCKUP_BADGE_SELECTOR) !== null;
    const hasAvatar = lockup.querySelector(LOCKUP_AVATAR_SELECTOR) !== null;
    // Sem avatar nem selo, a primeira linha pode ser "YouTube Playlist" ou
    // outra legenda que não é canal. O card clássico cobre o resto.
    if (!hasBadge && !hasAvatar) return null;

    const name = channelRules.cleanText(nameNode.textContent);
    if (!channelRules.isUsableChannelName(name)) return null;

    let anchor = nameNode;
    const next = nameNode.nextElementSibling;
    if (next !== null && typeof next.matches === 'function' && next.matches(LOCKUP_BADGE_SELECTOR)) {
      anchor = next;
    }
    return { row, anchor, name };
  }

  function isChannelPage() {
    const path = String(location.pathname || '');
    return (
      path.indexOf('/@') === 0 ||
      path.indexOf('/channel/') === 0 ||
      path.indexOf('/c/') === 0 ||
      path.indexOf('/user/') === 0
    );
  }

  function pageHandle() {
    return channelRules.handleFromHref(String(location.pathname || ''));
  }

  function scanPageHeader() {
    if (!isChannelPage()) return;
    const titles = document.querySelectorAll(PAGE_HEADER_TITLE_SELECTOR);
    for (let i = 0; i < titles.length; i += 1) {
      const title = titles[i];
      if (!isVisible(title)) continue;
      const name = channelRules.cleanText(title.textContent);
      if (!channelRules.isUsableChannelName(name)) continue;
      ensureHost(title, name, pageHandle(), 'watch', (host) => {
        if (host.parentNode !== title) title.appendChild(host);
      });
    }
  }

  function scanLockups() {
    const lockups = document.querySelectorAll(LOCKUP_SELECTOR);
    for (let i = 0; i < lockups.length; i += 1) {
      const lockup = lockups[i];
      if (!isVisible(lockup)) continue;
      const target = lockupTarget(lockup);
      if (target === null) continue;

      ensureHost(target.row, target.name, '', 'card', (host) => {
        if (host.parentNode === target.row && host.previousElementSibling === target.anchor) return;
        const row = target.anchor.parentNode;
        if (row !== null && row !== undefined) row.insertBefore(host, target.anchor.nextSibling);
      });
    }
  }

  function scan() {
    if (!shouldRun()) return;
    injectStyle();
    scanClassicContainers();
    scanLockups();
    scanPageHeader();
  }

  function shouldRun() {
    if (stopped) return false;
    if (document.visibilityState === 'hidden') return false;
    return true;
  }

  /* ------------------------------------------------------------------ ciclo */

  function watchDom() {
    if (domWatched) return;
    const root = document.documentElement;
    if (root === null || root === undefined) {
      document.addEventListener('DOMContentLoaded', watchDom, { once: true });
      return;
    }
    domWatched = true;
    domObserver = new MutationObserver(scheduleScan);
    domObserver.observe(root, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', scheduleScan);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleScan();
    });
    scheduleScan();
  }

  function scheduleScan() {
    if (stopIfOrphaned()) return;
    if (scanTimer !== null) return;
    const wait = Math.max(0, 250 - (Date.now() - lastScanAt));
    scanTimer = setTimeout(() => {
      scanTimer = null;
      lastScanAt = Date.now();
      if (stopIfOrphaned()) return;
      scan();
    }, wait);
  }

  function sweep() {
    if (stopIfOrphaned()) return;
    scan();
  }

  function stopIfOrphaned() {
    if (stopped) return true;
    if (isExtensionAlive()) return false;
    stop();
    return true;
  }

  function removeOwnArtifacts() {
    const hosts = document.querySelectorAll(HOST_SELECTOR);
    for (let i = 0; i < hosts.length; i += 1) {
      if (hosts[i].getAttribute(INSTANCE_ATTRIBUTE) === INSTANCE_ID) hosts[i].remove();
    }
    const style = document.getElementById(STYLE_ID);
    if (style !== null && style.getAttribute(INSTANCE_ATTRIBUTE) === INSTANCE_ID) style.remove();
  }

  function stop() {
    stopped = true;
    if (scanTimer !== null) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    if (sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    if (domObserver !== null) {
      domObserver.disconnect();
      domObserver = null;
    }
    removeOwnArtifacts();
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
    const next = channelRules.nextBlockedChannels(name, blockedChannels);

    setPending(host, true);
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
      if (!isExtensionAlive()) {
        stop();
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

  function readSettings() {
    try {
      chrome.storage.sync.get(
        { blockedChannels: [], allowedChannels: [] },
        (settings) => {
          const failed = typeof chrome.runtime !== 'undefined' && chrome.runtime.lastError;
          if (failed) return;
          setBlockedChannels(settings.blockedChannels);
          setAllowedChannels(settings.allowedChannels);
        },
      );
    } catch (error) {
      // Contexto invalidado: a próxima injeção revive o botão.
    }
  }

  function listenForChanges() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.blockedChannels) setBlockedChannels(changes.blockedChannels.newValue);
      if (changes.allowedChannels) setAllowedChannels(changes.allowedChannels.newValue);
    });
  }

  /* -------------------------------------------------------------------- start */

  function start() {
    if (started) return;
    started = true;

    removeOldArtifacts();
    injectStyle();
    readSettings();
    listenForChanges();
    watchDom();
    if (!stopped) sweepTimer = setInterval(sweep, 2000);
  }

  start();
})();
