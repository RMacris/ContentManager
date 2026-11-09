/**
 * Filtro de idade no site do YouTube.
 *
 * Esconde o card de vídeo cuja idade de publicação — a que o próprio YouTube
 * escreve no card ("há 4 dias", "1 week ago") — passa do limite escolhido no
 * popup (3 dias por padrão). O script não fala com a rede e não guarda nada
 * sobre os vídeos.
 *
 * O segundo interruptor esconde o que não é vídeo e não tem data para julgar:
 * o card de jogo (`/playables/`, "Jogado N mil vezes") e o anúncio no feed
 * ("Patrocinado"). A idade não decide esses — eles somem inteiros.
 *
 * O terceiro interruptor esconde o card cujo título tem uma das palavras-chave
 * da lista (`blockedKeywords`, que vem de fábrica com os termos de IA) ou cujo
 * canal está na lista de canais (`blockedChannels`). A ocultação é a mesma da
 * idade: `display: none` com marca no card, sem remover nó.
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

  // Já há uma instância viva? Recarregar a extensão órfã o script antigo: o
  // `chrome.runtime.id` dele apaga. A guarda devolve falso e a reinjeção
  // (chrome.scripting) pode reviver a aba sem refresh.
  const running = globalThis.__ytiAgeFilterAlive;
  if (typeof running === 'function' && running()) return;
  globalThis.__ytiAgeFilterAlive = isExtensionAlive;

  const keywordCore = typeof globalThis !== 'undefined' ? globalThis.YTIKeywordFilter : null;

  /** O contexto desta instância ainda fala com a extensão? */
  function isExtensionAlive() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime) && Boolean(chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

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

  /** Onde o card escreve o título do vídeo, do card antigo ao lockup novo. */
  const TITLE_SELECTORS = [
    '#video-title',
    '#video-title-link',
    '.yt-lockup-metadata-view-model__heading',
    'h3',
    'a[title]',
  ];

  /** Onde o card escreve o nome do canal que publicou o vídeo. */
  const CHANNEL_SELECTORS = [
    'ytd-channel-name a',
    '#channel-name a',
    'a[href^="/@"]',
    'a[href*="/channel/"]',
    'a[href*="/c/"]',
    'a[href*="/user/"]',
    '.yt-lockup-metadata-view-model__subheading',
  ];

  /** A página de inscrições, de onde sai o catálogo de canais. */
  const CHANNELS_PAGE_PATH = '/feed/channels';
  const SUBSCRIBED_CHANNEL_SELECTOR = 'ytd-channel-renderer';

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
  let blockingKeywords = false;
  let blockedKeywords = [];
  let blockedChannels = [];
  let allowedHandles = [];
  let allowedNames = [];
  let allowedSignature = '';
  let maxAgeDays = core.MAX_AGE_DAYS;
  let settingsRevision = 0;
  let started = false;
  let domWatched = false;
  let scanTimer = null;
  let lastScanAt = 0;
  let cache = new WeakMap();
  let keywordCache = new WeakMap();
  let collectedChannels = new Map();
  let lastCatalogSignature = '';
  let domObserver = null;
  let sweepTimer = null;
  let stopped = false;

  /* --------------------------------------------------------------- preferência */

  /** Algum filtro ligado? Desligados todos, a página fica como o YouTube fez. */
  function isActive() {
    return hidingAged || hidingPromoted || blockingKeywords;
  }

  /** Lê os interruptores; qualquer falha cai no padrão ligado. */
  function readSetting(done) {
    try {
      chrome.storage.sync.get(
        {
          hideOldVideos: true,
          hideGamesAndAds: true,
          maxAgeDays: core.MAX_AGE_DAYS,
          blockKeywords: false,
          blockedKeywords: [],
          blockedChannels: [],
          allowedChannels: [],
        },
        (settings) => {
          const failed = typeof chrome.runtime !== 'undefined' && chrome.runtime.lastError;
          if (failed) {
            done({ aged: true, promoted: true, ageLimit: core.MAX_AGE_DAYS });
            return;
          }
          done({
            aged: settings.hideOldVideos !== false,
            promoted: settings.hideGamesAndAds !== false,
            ageLimit: settings.maxAgeDays,
            blockKeywords: settings.blockKeywords === true,
            keywords: settings.blockedKeywords,
            channels: settings.blockedChannels,
            allowed: settings.allowedChannels,
          });
        },
      );
    } catch (error) {
      done({ aged: true, promoted: true, ageLimit: core.MAX_AGE_DAYS });
    }
  }

  /**
   * Liga/desliga ao vivo. Desligar tudo desfaz na hora o que estava escondido;
   * qualquer mudança recalcula a página inteira.
   */
  function setFlags(next) {
    const nextAged = next.aged !== false;
    const nextPromoted = next.promoted !== false;
    const nextMaxAgeDays = normalizeMaxAgeDays(next.ageLimit);
    const nextBlockingKeywords = next.blockKeywords === true;
    const nextKeywords = normalizeList(next.keywords);
    const nextChannels = normalizeList(next.channels);
    const nextAllowed = normalizeAllowed(next.allowed);
    const nextAllowedSignature = allowedSignatureOf(nextAllowed);
    if (
      nextAged === hidingAged &&
      nextPromoted === hidingPromoted &&
      nextMaxAgeDays === maxAgeDays &&
      nextBlockingKeywords === blockingKeywords &&
      nextKeywords === blockedKeywords &&
      nextChannels === blockedChannels &&
      nextAllowedSignature === allowedSignature
    ) {
      if (isActive()) scheduleScan();
      return;
    }
    hidingAged = nextAged;
    hidingPromoted = nextPromoted;
    maxAgeDays = nextMaxAgeDays;
    blockingKeywords = nextBlockingKeywords;
    blockedKeywords = nextKeywords;
    blockedChannels = nextChannels;
    allowedHandles = nextAllowed.handles;
    allowedNames = nextAllowed.names;
    allowedSignature = nextAllowedSignature;
    cache = new WeakMap();
    keywordCache = new WeakMap();
    if (isActive()) scheduleScan();
    else unhideAll();
  }

  function normalizeMaxAgeDays(value) {
    const days = Number(value);
    return Number.isInteger(days) && days >= 1 && days <= 365 ? days : core.MAX_AGE_DAYS;
  }

  /** A lista que veio do armazenamento, só com texto útil. */
  function normalizeList(values) {
    if (!Array.isArray(values)) return [];
    const list = [];
    for (let i = 0; i < values.length; i += 1) {
      if (typeof values[i] !== 'string') continue;
      const value = values[i].trim();
      if (value !== '') list.push(value);
    }
    return list;
  }

  /** A allowlist vira dois conjuntos: handles e nomes normalizados. */
  function normalizeAllowed(values) {
    const handles = [];
    const names = [];
    if (!Array.isArray(values)) return { handles, names };
    for (let i = 0; i < values.length; i += 1) {
      const entry = values[i];
      if (entry === null || typeof entry !== 'object') continue;
      if (typeof entry.handle === 'string' && entry.handle.trim() !== '') {
        handles.push(normalizeHandle(entry.handle));
      }
      if (typeof entry.name === 'string' && entry.name.trim() !== '') {
        names.push(normalizeChannelName(entry.name));
      }
    }
    return { handles, names };
  }

  function allowedSignatureOf(allowed) {
    return allowed.handles.join('\u0001') + '\u0002' + allowed.names.join('\u0001');
  }

  function normalizeHandle(value) {
    return value.trim().replace(/^@/, '').toLowerCase();
  }

  function normalizeChannelName(value) {
    if (keywordCore !== null && keywordCore !== undefined) return keywordCore.normalizeText(value);
    return value.trim().toLowerCase();
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
    domObserver = new MutationObserver(scheduleScan);
    domObserver.observe(root, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', scheduleScan);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleScan();
    });
    scheduleScan();
  }

  /**
   * Instância órfã não pode ficar brigando com a nova: quando o contexto morre
   * (extensão recarregada), o timer e o observer param na próxima volta.
   */
  function stopIfOrphaned() {
    if (stopped) return true;
    if (isExtensionAlive()) return false;
    stop();
    return true;
  }

  function stop() {
    stopped = true;
    if (sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    if (domObserver !== null) {
      domObserver.disconnect();
      domObserver = null;
    }
  }

  /** Agenda uma varredura, com um piso de 500 ms entre uma e outra. */
  function scheduleScan() {
    if (stopIfOrphaned()) return;
    if (!shouldScan()) return;
    if (scanTimer !== null) return;
    const wait = Math.max(0, 500 - (Date.now() - lastScanAt));
    scanTimer = setTimeout(() => {
      scanTimer = null;
      lastScanAt = Date.now();
      if (stopIfOrphaned()) return;
      scan();
    }, wait);
  }

  /** A varredura periódica: pega o card que envelheceu sem mudança de nó. */
  function sweep() {
    if (stopIfOrphaned()) return;
    if (!shouldScan()) return;
    if (document.visibilityState === 'hidden') return;
    scan();
  }

  /**
   * Há algo a fazer nesta página? Filtros ligados sempre; na página de
   * inscrições também, porque é de lá que sai o catálogo dos sempre
   * recomendados (mesmo com os filtros desligados).
   */
  function shouldScan() {
    return isActive() || isChannelsPage();
  }

  function isChannelsPage() {
    return String(location.pathname || '') === CHANNELS_PAGE_PATH;
  }

  function scan() {
    if (!shouldScan()) return;
    if (isSkippedPath()) {
      unhideAll();
      return;
    }

    if (isChannelsPage()) collectSubscribedChannels();

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

  /** O título do vídeo: o primeiro seletor que tem texto decide. */
  function titleText(card) {
    for (let i = 0; i < TITLE_SELECTORS.length; i += 1) {
      const node = card.querySelector(TITLE_SELECTORS[i]);
      if (node === null || node === undefined) continue;
      const text = textWithBreaks(node);
      if (text !== '') return text;
    }
    return '';
  }

  /** Os nós de canal que o card mostra, sem repetir o mesmo nó. */
  function channelNodes(card) {
    const nodes = [];
    for (let i = 0; i < CHANNEL_SELECTORS.length; i += 1) {
      const found = card.querySelectorAll(CHANNEL_SELECTORS[i]);
      for (let j = 0; j < found.length; j += 1) {
        if (nodes.indexOf(found[j]) === -1) nodes.push(found[j]);
      }
    }
    return nodes;
  }

  /** Os nomes de canal que o card mostra (o do texto e o do avatar). */
  function channelTexts(card) {
    const texts = [];
    const nodes = channelNodes(card);
    for (let i = 0; i < nodes.length; i += 1) {
      const text = textWithBreaks(nodes[i]);
      if (text !== '') texts.push(text);
    }
    return texts;
  }

  /**
   * O card tem palavra-chave no título ou canal na lista de bloqueados?
   *
   * A assinatura evita reprocessar em cada varredura: muda quando o YouTube
   * recicla o card ou troca o texto dele.
   */
  function isKeywordBlocked(card) {
    if (keywordCore === null || keywordCore === undefined) return false;
    const title = titleText(card);
    const channels = channelTexts(card);
    const signature = title + '\u0001' + channels.join('\u0001');
    const cached = keywordCache.get(card);
    if (cached !== undefined && cached.signature === signature) return cached.blocked;

    let blocked = keywordCore.matchesKeyword(title, blockedKeywords);
    if (!blocked) {
      for (let i = 0; i < channels.length; i += 1) {
        if (keywordCore.matchesChannel(channels[i], blockedChannels)) {
          blocked = true;
          break;
        }
      }
    }
    // Layout desconhecido (sem título reconhecível): o texto inteiro do card
    // ainda encontra a palavra-chave, em vez de o filtro falhar aberto.
    if (!blocked && title === '') {
      blocked = keywordCore.matchesKeyword(textWithBreaks(card), blockedKeywords);
    }

    keywordCache.set(card, { signature, blocked });
    return blocked;
  }

  /* ------------------------------------------------------- sempre recomendados */

  /**
   * O canal do card está na allowlist? Casa pelo handle do link (`/@nome`) ou
   * pelo nome exato normalizado. Quem está aqui nunca é escondido — a idade, a
   * palavra-chave e até um canal bloqueado perdem para a allowlist.
   */
  function isAllowedCard(card) {
    if (allowedHandles.length === 0 && allowedNames.length === 0) return false;
    const nodes = channelNodes(card);
    for (let i = 0; i < nodes.length; i += 1) {
      const handle = channelHandleOf(nodes[i]);
      if (handle !== '' && allowedHandles.indexOf(handle) !== -1) return true;
      const name = textWithBreaks(nodes[i]);
      if (name !== '' && allowedNames.indexOf(normalizeChannelName(name)) !== -1) return true;
    }
    return false;
  }

  /** O handle do canal a partir do href do link, sem `@` e em minúsculas. */
  function channelHandleOf(node) {
    if (typeof node.getAttribute !== 'function') return '';
    const href = node.getAttribute('href');
    if (typeof href !== 'string') return '';
    const match = href.match(/^\/@([^/?#]+)/) || href.match(/youtube\.com\/@([^/?#]+)/);
    if (match === null) return '';
    try {
      return decodeURIComponent(match[1]).toLowerCase();
    } catch (error) {
      return match[1].toLowerCase();
    }
  }

  /**
   * Na página de inscrições, guarda o que os cards de canal mostram. A varredura
   * roda de novo a cada card novo (scroll), e o service worker mescla com o
   * catálogo que já estava guardado.
   */
  function collectSubscribedChannels() {
    const items = document.querySelectorAll(SUBSCRIBED_CHANNEL_SELECTOR);
    let changed = false;

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const nameNode = item.querySelector('#channel-title #text') || item.querySelector('#text');
      const name = nameNode === null ? '' : textWithBreaks(nameNode);
      if (name === '') continue;

      const mainLink = item.querySelector('#main-link');
      const href = mainLink === null || typeof mainLink.getAttribute !== 'function'
        ? null
        : mainLink.getAttribute('href');
      const subscribersNode = item.querySelector('#subscribers');
      const subscribers = subscribersNode === null ? '' : textWithBreaks(subscribersNode);
      const handle = subscribers.startsWith('@')
        ? subscribers.split(' ')[0]
        : handleFromHref(href);

      const avatarNode = item.querySelector('#img');
      const avatarUrl = avatarNode === null || typeof avatarNode.getAttribute !== 'function'
        ? ''
        : avatarNode.getAttribute('src') || '';

      const key = (handle || name).toLowerCase();
      const previous = collectedChannels.get(key);
      if (
        previous === undefined ||
        previous.name !== name ||
        previous.handle !== handle ||
        previous.avatarUrl !== avatarUrl
      ) {
        collectedChannels.set(key, { name, handle, avatarUrl });
        changed = true;
      }
    }

    if (!changed) return;
    const signature = Array.from(collectedChannels.keys()).sort().join('\u0001');
    if (signature === lastCatalogSignature) return;
    lastCatalogSignature = signature;

    try {
      chrome.runtime
        .sendMessage({ action: 'saveChannelCatalog', channels: Array.from(collectedChannels.values()) })
        .catch(() => {});
    } catch (error) {
      // Contexto invalidado (extensão recarregada): a próxima injeção resolve.
    }
  }

  function handleFromHref(href) {
    if (typeof href !== 'string') return '';
    const match = href.match(/^\/@([^/?#]+)/) || href.match(/youtube\.com\/@([^/?#]+)/);
    if (match === null) return '';
    try {
      return '@' + decodeURIComponent(match[1]);
    } catch (error) {
      return '@' + match[1];
    }
  }

  function evaluateCard(card) {
    // Anúncio e jogo somem por inteiro: a data deles não existe no card.
    if (isPromotedCard(card)) {
      if (hidingPromoted) hide(card);
      else show(card);
      return;
    }

    if (!blockingKeywords && !hidingAged) {
      show(card);
      return;
    }

    if (isShortsCard(card) || !isVideoCard(card)) {
      show(card);
      return;
    }

    // Sempre recomendado vence tudo: a allowlist é a última palavra.
    if (isAllowedCard(card)) {
      show(card);
      return;
    }

    // Palavra-chave no título ou canal bloqueado: mesma ocultação da idade.
    if (blockingKeywords && isKeywordBlocked(card)) {
      hide(card);
      return;
    }

    if (!hidingAged) {
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
      if (core.shouldHide(texts[i], maxAgeDays)) {
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
    keywordCache = new WeakMap();
  }

  /* ---------------------------------------------------------------------- start */

  function start() {
    if (started) return;
    started = true;

    const initialSettingsRevision = settingsRevision;
    readSetting((next) => {
      if (settingsRevision !== initialSettingsRevision) return;
      setFlags(next);
    });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        const agedChange = changes.hideOldVideos;
        const promotedChange = changes.hideGamesAndAds;
        const ageLimitChange = changes.maxAgeDays;
        const keywordToggleChange = changes.blockKeywords;
        const keywordsChange = changes.blockedKeywords;
        const channelsChange = changes.blockedChannels;
        const allowedChange = changes.allowedChannels;
        if (
          !agedChange &&
          !promotedChange &&
          !ageLimitChange &&
          !keywordToggleChange &&
          !keywordsChange &&
          !channelsChange &&
          !allowedChange
        ) {
          return;
        }
        settingsRevision += 1;
        setFlags({
          aged: agedChange ? agedChange.newValue : hidingAged,
          promoted: promotedChange ? promotedChange.newValue : hidingPromoted,
          ageLimit: ageLimitChange ? ageLimitChange.newValue : maxAgeDays,
          blockKeywords: keywordToggleChange ? keywordToggleChange.newValue : blockingKeywords,
          keywords: keywordsChange ? keywordsChange.newValue : blockedKeywords,
          channels: channelsChange ? channelsChange.newValue : blockedChannels,
          allowed: allowedChange ? allowedChange.newValue : { handles: allowedHandles, names: allowedNames },
        });
      });
    }

    watchDom();
    if (!stopped) sweepTimer = setInterval(sweep, 2000);
  }

  start();
})();
