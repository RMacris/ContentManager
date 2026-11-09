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
 *
 * A leitura do DOM — seletores, título, canais, metadados e o card de
 * inscrição — mora em `youtube-dom.js`. Aqui ficam só as regras: classificar o
 * modelo lido e decidir esconder ou mostrar.
 */
(function () {
  'use strict';

  const core = typeof globalThis !== 'undefined' ? globalThis.YTIAgeFilter : null;
  if (core === null || core === undefined) return;

  const keywordCore = typeof globalThis !== 'undefined' ? globalThis.YTIKeywordFilter : null;
  // A política das listas de canais vem de `channel-rules.js`, carregado antes
  // deste arquivo; o filtro é só um adaptador sobre ela.
  const channelRules = typeof globalThis !== 'undefined' ? globalThis.YTIChannelRules : null;
  if (channelRules === null || channelRules === undefined) return;

  // A leitura do DOM do YouTube vem de `youtube-dom.js`, carregado antes deste
  // arquivo; o filtro classifica o modelo lido e decide esconder ou mostrar.
  const youtubeDom = typeof globalThis !== 'undefined' ? globalThis.YTIYouTubeDom : null;
  if (youtubeDom === null || youtubeDom === undefined) return;

  // O ciclo da página (observer, navegação, visibilidade, varredura e guarda
  // de órfão) vem de `content-runtime.js`, carregado antes deste arquivo; o
  // filtro só registra o próprio scan.
  const runtimeCore = typeof globalThis !== 'undefined' ? globalThis.YTIContentRuntime : null;
  if (runtimeCore === null || runtimeCore === undefined) return;

  // Já há uma instância viva? Recarregar a extensão órfã o script antigo: o
  // `chrome.runtime.id` dele apaga. A guarda devolve falso e a reinjeção
  // (chrome.scripting) pode reviver a aba sem refresh.
  const running = globalThis.__ytiAgeFilterAlive;
  if (typeof running === 'function' && running()) return;
  globalThis.__ytiAgeFilterAlive = runtimeCore.isExtensionAlive;

  const OLD_ATTRIBUTE = 'data-yti-old';
  const DISPLAY_ATTRIBUTE = 'data-yti-old-display';
  const SHELF_ATTRIBUTE = 'data-yti-old-shelf';
  const SHELF_DISPLAY_ATTRIBUTE = 'data-yti-old-shelf-display';

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
  let allowedChannels = [];
  let allowedSignature = '';
  let maxAgeDays = core.MAX_AGE_DAYS;
  let settingsRevision = 0;
  let started = false;
  let runtime = null;
  let cache = new WeakMap();
  let keywordCache = new WeakMap();
  let collectedChannels = new Map();
  let lastCatalogSignature = '';

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
    const nextKeywords = channelRules.normalizeList(next.keywords);
    const nextChannels = channelRules.normalizeList(next.channels);
    const nextAllowed = channelRules.normalizeAllowed(next.allowed);
    const nextAllowedSignature = channelRules.allowedSignature(nextAllowed);
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
    allowedChannels = nextAllowed;
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

  /** Agenda a varredura deste adaptador pelo runtime compartilhado. */
  function scheduleScan() {
    if (runtime !== null) runtime.schedule();
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
    return youtubeDom.isChannelsPage(location.pathname);
  }

  function scan() {
    if (!shouldScan()) return;
    if (isSkippedPath()) {
      unhideAll();
      return;
    }

    if (isChannelsPage()) collectSubscribedChannels();

    const cards = document.querySelectorAll(youtubeDom.selectors.card);
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
    const shelves = document.querySelectorAll(youtubeDom.selectors.shelf);
    for (let i = 0; i < shelves.length; i += 1) {
      const shelf = shelves[i];
      const items = shelf.querySelectorAll(youtubeDom.selectors.shelfItem);
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
    const outer = parent.closest(youtubeDom.selectors.card);
    return outer !== null && outer !== card;
  }

  /**
   * O card tem palavra-chave no título ou canal na lista de bloqueados?
   *
   * A assinatura evita reprocessar em cada varredura: muda quando o YouTube
   * recicla o card ou troca o texto dele.
   */
  function isKeywordBlocked(read, card) {
    if (keywordCore === null || keywordCore === undefined) return false;
    const title = read.title;
    const channels = read.channels;
    const names = [];
    for (let i = 0; i < channels.length; i += 1) names.push(channels[i].name);
    const signature = title + '\u0001' + names.join('\u0001');
    const cached = keywordCache.get(card);
    if (cached !== undefined && cached.signature === signature) return cached.blocked;

    let blocked = keywordCore.matchesKeyword(title, blockedKeywords);
    if (!blocked) {
      for (let i = 0; i < names.length; i += 1) {
        if (channelRules.isBlockedChannel(names[i], blockedChannels)) {
          blocked = true;
          break;
        }
      }
    }
    // Layout desconhecido (sem título reconhecível): o texto inteiro do card
    // ainda encontra a palavra-chave, em vez de o filtro falhar aberto.
    if (!blocked && title === '') {
      blocked = keywordCore.matchesKeyword(read.wholeText, blockedKeywords);
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
  function isAllowedCard(read) {
    if (allowedChannels.length === 0) return false;
    const channels = read.channels;
    for (let i = 0; i < channels.length; i += 1) {
      if (channelRules.isAllowedChannel(channels[i].name, channels[i].handle, allowedChannels)) return true;
    }
    return false;
  }

  /**
   * Na página de inscrições, guarda o que os cards de canal mostram. A varredura
   * roda de novo a cada card novo (scroll), e o service worker mescla com o
   * catálogo que já estava guardado.
   */
  function collectSubscribedChannels() {
    const items = document.querySelectorAll(youtubeDom.selectors.subscriptionCard);
    let changed = false;

    for (let i = 0; i < items.length; i += 1) {
      const channel = youtubeDom.readSubscribedChannel(items[i]);
      if (channel === null) continue;

      const key = (channel.handle || channel.name).toLowerCase();
      const previous = collectedChannels.get(key);
      if (
        previous === undefined ||
        previous.name !== channel.name ||
        previous.handle !== channel.handle ||
        previous.avatarUrl !== channel.avatarUrl
      ) {
        collectedChannels.set(key, {
          name: channel.name,
          handle: channel.handle,
          avatarUrl: channel.avatarUrl,
        });
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

  function evaluateCard(card) {
    const read = youtubeDom.readCard(card);

    // Anúncio e jogo somem por inteiro: a data deles não existe no card.
    if (read.promoted) {
      if (hidingPromoted) hide(card);
      else show(card);
      return;
    }

    if (!blockingKeywords && !hidingAged) {
      show(card);
      return;
    }

    if (read.shorts || !read.video) {
      show(card);
      return;
    }

    // Sempre recomendado vence tudo: a allowlist é a última palavra.
    if (isAllowedCard(read)) {
      show(card);
      return;
    }

    // Palavra-chave no título ou canal bloqueado: mesma ocultação da idade.
    if (blockingKeywords && isKeywordBlocked(read, card)) {
      hide(card);
      return;
    }

    if (!hidingAged) {
      show(card);
      return;
    }

    const texts = read.metadataTexts;
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
          allowed: allowedChange ? allowedChange.newValue : allowedChannels,
        });
      });
    }

    runtime = runtimeCore.register({
      scan,
      shouldScan,
      // O filtro mantém o piso de 500 ms entre varreduras agendadas.
      minScanIntervalMs: 500,
    });
  }

  start();
})();
