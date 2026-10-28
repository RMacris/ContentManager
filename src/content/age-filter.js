/**
 * Filtro de idade no site do YouTube.
 *
 * Esconde o card de vídeo cuja idade de publicação — a que o próprio YouTube
 * escreve no card ("há 4 dias", "1 week ago") — é maior que 3 dias. O
 * interruptor do popup manda; o script não fala com a rede e não guarda nada
 * sobre os vídeos.
 *
 * Shorts ficam de fora: o bloqueio de URL que já existe continua sendo o dono
 * desse caminho. Histórico e listas salvas também: ali a data é uma ação do
 * usuário ("Assistido há…"), não uma recomendação — e esconder o item apagaria
 * a própria lista que ele abriu.
 */
(function () {
  'use strict';

  const core = typeof globalThis !== 'undefined' ? globalThis.YTIAgeFilter : null;
  if (core === null || core === undefined) return;
  if (globalThis.__ytiAgeFilterStarted === true) return;
  globalThis.__ytiAgeFilterStarted = true;

  const MAX_AGE_DAYS = core.MAX_AGE_DAYS;
  const OLD_ATTRIBUTE = 'data-yti-old';
  const DISPLAY_ATTRIBUTE = 'data-yti-old-display';

  /** Os cards de vídeo de hoje: rich item (home/canal), search e os antigos. */
  const CARD_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'yt-lockup-view-model',
  ].join(',');

  /** Onde o card escreve a idade: lockup novo e os blocos antigos. */
  const METADATA_SELECTOR = [
    '#metadata-line',
    'ytd-video-meta-block',
    'yt-content-metadata-view-model',
    '#metadata',
    '.inline-metadata-item',
  ].join(',');

  /** Cards de Shorts: nunca entram no filtro de idade. */
  const SHORTS_SELECTOR = [
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'ytd-shorts-lockup-view-model',
    'ytd-reel-item-renderer',
    'ytd-rich-grid-slim-media',
  ].join(',');

  /**
   * O que o usuário escolheu ver, não o que o YouTube recomendou. São as
   * páginas em que a data do card costuma ser a da ação ("Assistido há…") ou
   * que guardam o que ele salvou — filtrar ali apagaria a própria lista.
   */
  const SKIP_PATHS = [
    '/feed/history',
    '/feed/liked_videos',
    '/feed/watch_later',
    '/feed/library',
    '/feed/you',
    '/feed/clips',
    '/feed/downloads',
    '/feed/your_videos',
    '/feed/purchases',
    '/feed/memberships',
    '/playlist',
  ];

  let enabled = false;
  let started = false;
  let domWatched = false;
  let scanTimer = null;
  let lastScanAt = 0;
  let cache = new WeakMap();

  /* --------------------------------------------------------------- preferência */

  /** Lê o interruptor; qualquer falha cai no padrão ligado. */
  function readSetting(done) {
    try {
      chrome.storage.sync.get({ hideOldVideos: true }, (settings) => {
        const failed = typeof chrome.runtime !== 'undefined' && chrome.runtime.lastError;
        done(failed ? true : settings.hideOldVideos !== false);
      });
    } catch (error) {
      done(true);
    }
  }

  /**
   * Liga/desliga ao vivo. Desligar desfaz na hora o que estava escondido;
   * ligar recalcula a página inteira.
   */
  function setEnabled(next) {
    const value = next !== false;
    if (enabled === value) {
      if (value) scheduleScan();
      return;
    }
    enabled = value;
    cache = new WeakMap();
    if (value) scheduleScan();
    else unhideAll();
  }

  /* ------------------------------------------------------------------- páginas */

  function isSkippedPath() {
    const path = String(location.pathname || '');
    for (let i = 0; i < SKIP_PATHS.length; i += 1) {
      const prefix = SKIP_PATHS[i];
      if (path === prefix || path.startsWith(prefix + '/')) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------- varredura */

  /**
   * O YouTube é uma SPA e o feed carrega em pedaços: observa a árvore, escuta
   * a navegação e ainda varre de tempos em tempos, porque o card pode trocar o
   * texto de idade no lugar sem criar nó novo.
   */
  function watchDom() {
    if (domWatched) return;
    const root = document.documentElement;
    if (root === null) {
      document.addEventListener('DOMContentLoaded', watchDom, { once: true });
      return;
    }
    domWatched = true;
    const observer = new MutationObserver(scheduleScan);
    observer.observe(root, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', scheduleScan);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleScan();
    });
    scheduleScan();
  }

  /** Agenda uma varredura, com um piso de 500 ms entre uma e outra. */
  function scheduleScan() {
    if (!enabled) return;
    if (scanTimer !== null) return;
    const wait = Math.max(0, 500 - (Date.now() - lastScanAt));
    scanTimer = setTimeout(() => {
      scanTimer = null;
      lastScanAt = Date.now();
      scan();
    }, wait);
  }

  /** A varredura periódica: pega o card que envelheceu sem mudança de nó. */
  function sweep() {
    if (!enabled) return;
    if (document.visibilityState === 'hidden') return;
    scan();
  }

  function scan() {
    if (!enabled) return;

    if (isSkippedPath()) {
      unhideAll();
      return;
    }

    const cards = document.querySelectorAll(CARD_SELECTOR);
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i];
      if (isNestedCard(card)) continue;
      evaluateCard(card);
    }
  }

  /** O lockup dentro do rich item é o mesmo card: avalia só o de fora. */
  function isNestedCard(card) {
    const parent = card.parentElement;
    if (parent === null) return false;
    const outer = parent.closest(CARD_SELECTOR);
    return outer !== null && outer !== card;
  }

  function isShortsCard(card) {
    if (card.matches(SHORTS_SELECTOR)) return true;
    if (card.querySelector(SHORTS_SELECTOR) !== null) return true;
    if (card.querySelector('a[href*="/shorts/"]') !== null) return true;
    return false;
  }

  /** Só card de vídeo: playlist, canal, post e anúncio ficam de fora. */
  function isVideoCard(card) {
    if (card.querySelector('a[href*="/playlist"]') !== null) return false;
    return card.querySelector('a[href*="/watch?v="]') !== null;
  }

  /**
   * O texto do bloco com um espaço entre cada trecho.
   *
   * O `textContent` cola os filhos sem separador — a home escreve
   * `<span>1,2 mi de visualizações</span><span>Assistido há 5 dias</span>`, e o
   * resultado "visualizaçõesAssistido" escapa da guarda de ação, que lê
   * palavra por palavra. Separar os trechos devolve as palavras que o card
   * mostra, e continua certo quando a idade está quebrada em vários nós
   * ("há <b>5</b> dias").
   */
  function textWithBreaks(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const parts = [];
    let current = walker.nextNode();
    while (current !== null) {
      const data = current.data.trim();
      if (data !== '') parts.push(data);
      current = walker.nextNode();
    }
    return parts.join(' ');
  }

  /** Os textos que podem carregar a idade, do bloco inteiro e de cada parte. */
  function metadataTexts(card) {
    const nodes = card.querySelectorAll(METADATA_SELECTOR);
    const texts = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const whole = textWithBreaks(node);
      if (whole) texts.push(whole);
      const spans = node.querySelectorAll('span');
      for (let j = 0; j < spans.length; j += 1) {
        const part = textWithBreaks(spans[j]);
        if (part) texts.push(part);
      }
    }
    return texts;
  }

  function evaluateCard(card) {
    if (isShortsCard(card) || !isVideoCard(card)) {
      show(card);
      return;
    }

    const texts = metadataTexts(card);
    if (texts.length === 0) {
      show(card);
      return;
    }

    // A assinatura evita reparsear em cada varredura; muda quando o card muda
    // de idade ou é reciclado pelo YouTube.
    const signature = texts.join('\u0001');
    if (cache.get(card) === signature) return;
    cache.set(card, signature);

    let old = false;
    for (let i = 0; i < texts.length; i += 1) {
      if (core.shouldHide(texts[i], MAX_AGE_DAYS)) {
        old = true;
        break;
      }
    }

    if (old) hide(card);
    else show(card);
  }

  /* --------------------------------------------------------------------- estilo */

  function hide(card) {
    if (card.getAttribute(OLD_ATTRIBUTE) !== '1') {
      card.setAttribute(DISPLAY_ATTRIBUTE, card.style.display || '');
      card.setAttribute(OLD_ATTRIBUTE, '1');
    }
    card.style.setProperty('display', 'none', 'important');
  }

  function show(card) {
    if (card.getAttribute(OLD_ATTRIBUTE) !== '1') return;
    const display = card.getAttribute(DISPLAY_ATTRIBUTE);
    card.removeAttribute(OLD_ATTRIBUTE);
    card.removeAttribute(DISPLAY_ATTRIBUTE);
    if (display === null || display === '') card.style.removeProperty('display');
    else card.style.display = display;
  }

  function unhideAll() {
    const hidden = document.querySelectorAll('[' + OLD_ATTRIBUTE + ']');
    for (let i = 0; i < hidden.length; i += 1) show(hidden[i]);
    cache = new WeakMap();
  }

  /* ---------------------------------------------------------------------- start */

  function start() {
    if (started) return;
    started = true;

    readSetting((value) => {
      setEnabled(value);
    });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.hideOldVideos) return;
        setEnabled(changes.hideOldVideos.newValue !== false);
      });
    }

    watchDom();
    setInterval(sweep, 2000);
  }

  start();
})();
