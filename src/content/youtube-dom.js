/**
 * Leitura do DOM do YouTube.
 *
 * O filtro de idade e o chip de canal enxergam a mesma página: o card de
 * vídeo, o lockup novo, o anúncio, o Shorts, o cabeçalho do canal e o card de
 * inscrição. Este módulo é o único dono dos seletores e da extração; cada
 * consumidor recebe o modelo lido e decide o que fazer com ele.
 *
 *  - `readCard` devolve o card classificado (anúncio, Shorts, vídeo), o
 *    título, os canais e os textos de metadados; o filtro classifica.
 *  - `readChannelTarget` devolve o alvo do chip (nome, handle, superfície e
 *    onde montar); o chip se posiciona.
 *  - `readSubscribedChannel` devolve um card da página de inscrições; o
 *    catálogo o consome.
 *
 * Script clássico, sem import/export: `channel-rules.js` carrega antes e
 * resolve a identidade do canal. Nada aqui altera o DOM.
 */
(function (root) {
  'use strict';

  // As regras de lista vêm de `channel-rules.js`, carregado antes deste
  // arquivo; a leitura usa a mesma normalização de handle do resto da extensão.
  const channelRules = typeof root.YTIChannelRules !== 'undefined' ? root.YTIChannelRules : null;
  if (channelRules === null || channelRules === undefined) return;

  const document = root.document;

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

  /**
   * Os cards em que o chip compacto aparece. É mais largo que o card do
   * filtro de propósito: playlist e Shorts não são julgados pela idade, mas o
   * nome do canal ali ainda ganha o botão.
   */
  const CHIP_CARD_SELECTOR = [
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

  /** Prateleira da home (jogos, "assistir de novo"): some se ficar sem card. */
  const SHELF_SELECTOR = 'ytd-rich-shelf-renderer';
  const SHELF_ITEM_SELECTOR = 'ytd-rich-item-renderer';

  /** A página de inscrições, de onde sai o catálogo de canais. */
  const CHANNELS_PAGE_PATH = '/feed/channels';
  const SUBSCRIBED_CHANNEL_SELECTOR = 'ytd-channel-renderer';

  /** O link do canal: o nome do dono, dos cards e do cabeçalho do canal. */
  const CHANNEL_LINK_SELECTOR = [
    'a[href^="/@"]',
    'a[href*="/channel/"]',
    'a[href*="/c/"]',
    'a[href*="/user/"]',
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
  const CHANNEL_CONTAINER_SELECTOR = 'ytd-channel-name';
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

  /** Os caminhos em que o cabeçalho grande é do canal, não de um vídeo. */
  const CHANNEL_PAGE_PREFIXES = ['/@', '/channel/', '/c/', '/user/'];

  /* --------------------------------------------------------------- utilidades */

  function isVisible(node) {
    return Boolean(node) && typeof node.getClientRects === 'function' && node.getClientRects().length > 0;
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

  /** O texto já limpo para virar nome de canal ou handle. */
  function cleanTextWithBreaks(node) {
    return node === null || node === undefined ? '' : channelRules.cleanText(textWithBreaks(node));
  }

  /** Calcula uma leitura só quando o consumidor realmente precisa dela. */
  function lazy(read) {
    let done = false;
    let value;
    return function () {
      if (!done) {
        value = read();
        done = true;
      }
      return value;
    };
  }

  /* --------------------------------------------------------------------- card */

  /** Anúncio ou card de jogo: não tem data de publicação para julgar. */
  function isPromotedCard(card) {
    if (card.matches(PROMOTED_SELECTOR)) return true;
    return card.querySelector(PROMOTED_SELECTOR) !== null;
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

  /** Os canais do card com nome e handle na mesma leitura. */
  function readChannels(card) {
    const nodes = channelNodes(card);
    const channels = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const href = typeof node.getAttribute === 'function' ? node.getAttribute('href') : null;
      const name = cleanTextWithBreaks(node);
      if (name === '') continue;
      channels.push({
        name,
        handle: channelRules.handleFromHref(href),
      });
    }
    return channels;
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

  /**
   * O card como dados: classificação e conteúdo, sem decidir nada.
   *
   * Os campos são calculados na primeira leitura. Um scan em que só o
   * interruptor de anúncios está ligado não paga a leitura de título, canais
   * nem metadados de cada card.
   */
  function readCard(card) {
    const promoted = lazy(() => isPromotedCard(card));
    const shorts = lazy(() => isShortsCard(card));
    const video = lazy(() => isVideoCard(card));
    const title = lazy(() => titleText(card));
    const channels = lazy(() => readChannels(card));
    const metadata = lazy(() => metadataTexts(card));
    const wholeText = lazy(() => channelRules.cleanText(textWithBreaks(card)));

    return {
      element: card,
      get promoted() {
        return promoted();
      },
      get shorts() {
        return shorts();
      },
      get video() {
        return video();
      },
      get title() {
        return title();
      },
      get channels() {
        return channels();
      },
      get metadataTexts() {
        return metadata();
      },
      get wholeText() {
        return wholeText();
      },
    };
  }

  /* -------------------------------------------------------------------- chip */

  function isChannelPagePath(pathname) {
    const path = String(pathname === null || pathname === undefined ? '' : pathname);
    for (let i = 0; i < CHANNEL_PAGE_PREFIXES.length; i += 1) {
      if (path.indexOf(CHANNEL_PAGE_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  /** O `ytd-channel-name` clássico: link com nome e handle. */
  function readClassicTarget(container) {
    if (typeof container.closest !== 'function') return null;
    const card = container.closest(CHIP_CARD_SELECTOR);
    const header = container.closest(HEADER_SELECTOR);
    if (card === null && header === null) return null;

    const link = container.querySelector(CHANNEL_LINK_SELECTOR);
    if (link === null) return null;

    const text = container.querySelector('#text');
    let name = text === null ? '' : channelRules.cleanText(text.textContent);
    if (name === '') name = channelRules.cleanText(link.textContent);
    if (!channelRules.isUsableChannelName(name)) return null;

    return {
      key: container,
      name,
      handle: channelRules.handleFromHref(link.getAttribute('href')),
      surface: card !== null ? 'card' : 'watch',
      parent: container,
      after: null,
    };
  }

  /**
   * O lockup novo não tem link no nome do canal. A primeira linha de metadados
   * é o nome; a linha de playlist ("YouTube Playlist") não tem badge, avatar
   * nem as partes de views/idade, então fica de fora.
   */
  function readLockupTarget(lockup) {
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
    return {
      key: row,
      name,
      handle: '',
      surface: 'card',
      parent: anchor.parentNode,
      after: anchor,
    };
  }

  /** O título da página de canal, com o handle vindo do caminho. */
  function readPageTarget(title, pathname) {
    if (!isChannelPagePath(pathname)) return null;
    const name = channelRules.cleanText(title.textContent);
    if (!channelRules.isUsableChannelName(name)) return null;
    return {
      key: title,
      name,
      handle: channelRules.handleFromHref(pathname),
      surface: 'watch',
      parent: title,
      after: null,
    };
  }

  /**
   * O alvo do chip em um dos três lugares em que o nome do canal aparece.
   *
   * `kind` é `'classic'` (o `ytd-channel-name`), `'lockup'` (o card novo) ou
   * `'page'` (o título grande da página de canal). O chip recebe o nome, o
   * handle, a superfície e o ponto de montagem; a inserção é dele.
   */
  function readChannelTarget(node, options) {
    const settings = options === null || options === undefined ? {} : options;
    const kind = settings.kind === 'lockup' || settings.kind === 'page' ? settings.kind : 'classic';
    if (!isVisible(node)) return null;
    if (kind === 'lockup') return readLockupTarget(node);
    if (kind === 'page') return readPageTarget(node, settings.pathname);
    return readClassicTarget(node);
  }

  /* ------------------------------------------------------------- inscrições */

  /** O handle como o catálogo o exibe, com `@` na frente. */
  function displayHandleFromHref(href) {
    const handle = channelRules.handleFromHref(href);
    return handle === '' ? '' : '@' + handle;
  }

  /**
   * Um card da página de inscrições: nome, handle e avatar.
   *
   * O handle prefere o texto de `#subscribers` ("@nome"); quando ele não
   * começa com `@`, o caminho de `#main-link` decide.
   */
  function readSubscribedChannel(item) {
    const nameNode = item.querySelector('#channel-title #text') || item.querySelector('#text');
    const name = cleanTextWithBreaks(nameNode);
    if (name === '') return null;

    const mainLink = item.querySelector('#main-link');
    const href = mainLink === null || typeof mainLink.getAttribute !== 'function'
      ? null
      : mainLink.getAttribute('href');
    const subscribersNode = item.querySelector('#subscribers');
    const subscribers = cleanTextWithBreaks(subscribersNode);
    const handle = subscribers.indexOf('@') === 0
      ? subscribers.split(' ')[0]
      : displayHandleFromHref(href);

    const avatarNode = item.querySelector('#img');
    const avatarUrl = avatarNode === null || typeof avatarNode.getAttribute !== 'function'
      ? ''
      : avatarNode.getAttribute('src') || '';

    return { name, handle, avatarUrl };
  }

  /* ------------------------------------------------------------------- API */

  root.YTIYouTubeDom = {
    selectors: {
      card: CARD_SELECTOR,
      shelf: SHELF_SELECTOR,
      shelfItem: SHELF_ITEM_SELECTOR,
      channelContainer: CHANNEL_CONTAINER_SELECTOR,
      lockup: LOCKUP_SELECTOR,
      pageHeaderTitle: PAGE_HEADER_TITLE_SELECTOR,
      subscriptionCard: SUBSCRIBED_CHANNEL_SELECTOR,
    },
    isChannelsPage(pathname) {
      return String(pathname === null || pathname === undefined ? '' : pathname) === CHANNELS_PAGE_PATH;
    },
    textWithBreaks,
    readCard,
    readChannelTarget,
    readSubscribedChannel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
