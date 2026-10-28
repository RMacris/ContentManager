/**
 * Filtro de idade no site do YouTube.
 *
 * Esconde o card de vídeo cuja idade de publicação — a que o próprio YouTube
 * escreve no card ("há 4 dias", "1 week ago") — é maior que 3 dias. O
 * interruptor do popup manda; o script não fala com a rede e não guarda nada
 * sobre os vídeos.
 *
 * O segundo interruptor esconde o que não é vídeo e não tem data para julgar:
 * o card de jogo (`/playables/`, "Jogado N mil vezes") e o anúncio no feed
 * ("Patrocinado"). A idade não decide esses — eles somem inteiros.
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
  const SHELF_ATTRIBUTE = 'data-yti-old-shelf';
  const SHELF_DISPLAY_ATTRIBUTE = 'data-yti-old-shelf-display';

  /** Os cards de vídeo de hoje: rich item (home/canal), search e os antigos. */
  const CARD_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'yt-lockup-view-model',
    // Anúncio também é card: o slot no feed, o da busca e o da coluna lateral.
    'ytd-ad-slot-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-display-ad-renderer',
  ].join(',');

  /**
   * O que não é vídeo com data de publicação — não há idade para julgar.
   *
   * O card de jogo da prateleira de playables e o anúncio no feed: os dois têm
   * interruptor próprio e são escondidos por inteiro, sem olhar a data.
   */
  const PROMOTED_SELECTOR = [
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer',
    'feed-ad-metadata-view-model',
    'ad-badge-view-model',
    'ytd-mini-game-card-view-model',
    'mini-game-card-view-model',
    'a[href*="/playables/"]',
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

  /** Prateleira da home (jogos, "assistir de novo"): some se ficar sem card. */
  const SHELF_SELECTOR = 'ytd-rich-shelf-renderer';

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

  let hidingAged = false;
  let hidingPromoted = false;
  let started = false;
  let domWatched = false;
  let scanTimer = null;
  let lastScanAt = 0;
  let cache = new WeakMap();

  /* --------------------------------------------------------------- preferência */

  /** Algum filtro ligado? Desligados os dois, a página fica como o YouTube fez. */
  function isActive() {
    return hidingAged || hidingPromoted;
  }

  /** Lê os interruptores; qualquer falha cai no padrão ligado. */
  function readSetting(done) {
    try {
      chrome.storage.sync.get({ hideOldVideos: true, hideGamesAndAds: true }, (settings) => {
        const failed = typeof chrome.runtime !== 'undefined' && chrome.runtime.lastError;
        if (failed) done(true, true);
        else done(settings.hideOldVideos !== false, settings.hideGamesAndAds !== false);
      });
    } catch (error) {
      done(true, true);
    }
  }

  /**
   * Liga/desliga ao vivo. Desligar os dois desfaz na hora o que estava
   * escondido; qualquer mudança recalcula a página inteira.
   */
  function setFlags(aged, promoted) {
    const nextAged = aged !== false;
    const nextPromoted = promoted !== false;
    if (nextAged === hidingAged && nextPromoted === hidingPromoted) {
      if (isActive()) scheduleScan();
      return;
    }
    hidingAged = nextAged;
    hidingPromoted = nextPromoted;
    cache = new WeakMap();
    if (isActive()) scheduleScan();
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
    if (!isActive()) return;
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
    if (!isActive()) return;
    if (document.visibilityState === 'hidden') return;
    scan();
  }

  function scan() {
    if (!isActive()) return;

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

    collapseShelves();
  }

  /**
   * Prateleira que ficou sem nenhum card visível some com ele.
   *
   * O YouTube não recolhe a prateleira sozinho: esconder os jogos deixaria o
   * título "Jogar" com um vazio embaixo. Só some a prateleira cujos cards
   * foram todos marcados por este filtro — a de Shorts, que nunca é tocada,
   * continua de pé.
   */
  function collapseShelves() {
    const shelves = document.querySelectorAll(SHELF_SELECTOR);
    for (let i = 0; i < shelves.length; i += 1) {
      const shelf = shelves[i];
      const items = shelf.querySelectorAll('ytd-rich-item-renderer');
      let collapsed = items.length > 0;
      for (let j = 0; j < items.length && collapsed; j += 1) {
        if (items[j].getAttribute(OLD_ATTRIBUTE) !== '1') collapsed = false;
      }
      if (collapsed) hideShelf(shelf);
      else showShelf(shelf);
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

  /** Só card de vídeo: playlist, canal e post ficam de fora. */
  function isVideoCard(card) {
    if (card.querySelector('a[href*="/playlist"]') !== null) return false;
    return card.querySelector('a[href*="/watch?v="]') !== null;
  }

  /** Anúncio ou card de jogo: não tem data de publicação para julgar. */
  function isPromotedCard(card) {
    if (card.matches(PROMOTED_SELECTOR)) return true;
    return card.querySelector(PROMOTED_SELECTOR) !== null;
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
    // Anúncio e jogo somem por inteiro: a data deles não existe no card.
    if (isPromotedCard(card)) {
      if (hidingPromoted) hide(card);
      else show(card);
      return;
    }

    if (!hidingAged) {
      show(card);
      return;
    }

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

  function hideShelf(shelf) {
    if (shelf.getAttribute(SHELF_ATTRIBUTE) !== '1') {
      shelf.setAttribute(SHELF_DISPLAY_ATTRIBUTE, shelf.style.display || '');
      shelf.setAttribute(SHELF_ATTRIBUTE, '1');
    }
    shelf.style.setProperty('display', 'none', 'important');
  }

  function showShelf(shelf) {
    if (shelf.getAttribute(SHELF_ATTRIBUTE) !== '1') return;
    const display = shelf.getAttribute(SHELF_DISPLAY_ATTRIBUTE);
    shelf.removeAttribute(SHELF_ATTRIBUTE);
    shelf.removeAttribute(SHELF_DISPLAY_ATTRIBUTE);
    if (display === null || display === '') shelf.style.removeProperty('display');
    else shelf.style.display = display;
  }

  function unhideAll() {
    const hidden = document.querySelectorAll('[' + OLD_ATTRIBUTE + '], [' + SHELF_ATTRIBUTE + ']');
    for (let i = 0; i < hidden.length; i += 1) {
      if (hidden[i].getAttribute(SHELF_ATTRIBUTE) === '1') showShelf(hidden[i]);
      else show(hidden[i]);
    }
    cache = new WeakMap();
  }

  /* ---------------------------------------------------------------------- start */

  function start() {
    if (started) return;
    started = true;

    readSetting((aged, promoted) => {
      setFlags(aged, promoted);
    });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        const agedChange = changes.hideOldVideos;
        const promotedChange = changes.hideGamesAndAds;
        if (!agedChange && !promotedChange) return;
        setFlags(
          agedChange ? agedChange.newValue : hidingAged,
          promotedChange ? promotedChange.newValue : hidingPromoted,
        );
      });
    }

    watchDom();
    setInterval(sweep, 2000);
  }

  start();
})();
