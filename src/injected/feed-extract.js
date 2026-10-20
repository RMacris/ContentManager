/**
 * Extração dos cards do feed do YouTube.
 *
 * ATENÇÃO, REGRA DESTE ARQUIVO: as funções aqui são **serializadas** e injetadas
 * no mundo MAIN da página. Lá dentro não existe escopo de módulo, `import`, nem
 * qualquer variável deste arquivo. Cada função tem que ser autossuficiente.
 *
 * Por que ler o JSON e não o DOM: medido no ticket 04 do mapa, no DOM 68 de 120
 * thumbnails e 0 de 20 avatares vinham vazios (lazy loading), enquanto o payload
 * tinha todos. O DOM também não é acessível de fora do mundo MAIN para o
 * `ytInitialData`.
 */

/**
 * Lê os cards do topo do feed a partir do `ytInitialData`.
 *
 * @param {number} maxCards teto de cards — só o topo, sem paginar.
 * @param {object|null} data JSON já pronto (rota sem aba, no service worker);
 *   na página, `null` faz a função ler `window.ytInitialData`, como sempre.
 */
export function extractFeedCards(maxCards, data = null) {
  const source =
    data && typeof data === 'object'
      ? data
      : typeof window !== 'undefined'
        ? window.ytInitialData
        : null;
  if (!source || typeof source !== 'object') {
    return { ok: false, reason: 'ytInitialData ausente', cards: [], buildLabel: null };
  }

  const limit = typeof maxCards === 'number' && maxCards > 0 ? maxCards : 30;
  const cards = [];
  const seen = Object.create(null);

  function textOf(node) {
    if (!node || typeof node !== 'object') return '';
    if (typeof node.simpleText === 'string') return node.simpleText;
    if (typeof node.content === 'string') return node.content;
    if (Array.isArray(node.runs)) {
      let out = '';
      for (let i = 0; i < node.runs.length; i++) {
        const run = node.runs[i];
        if (run && typeof run.text === 'string') out += run.text;
      }
      return out;
    }
    return '';
  }

  function dig(node, path) {
    let current = node;
    for (let i = 0; i < path.length; i++) {
      if (!current || typeof current !== 'object') return null;
      current = current[path[i]];
    }
    return current && typeof current === 'object' ? current : null;
  }

  function avatarFrom(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    const first = sources[0];
    return first && typeof first.url === 'string' ? first.url : null;
  }

  /** Card no formato novo (`yt-lockup-view-model`). */
  function fromLockup(node) {
    if (node.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
    const id = node.contentId;
    if (typeof id !== 'string' || id.length === 0) return null;

    const md = dig(node, ['metadata', 'lockupMetadataViewModel']);
    if (md === null) return null;

    // As linhas de metadados ficam dois níveis abaixo: o `metadata` de dentro do
    // lockup é o `contentMetadataViewModel`. O fallback cobre variação de forma.
    const contentMetadata = dig(md, ['metadata', 'contentMetadataViewModel']);
    const rows =
      contentMetadata && Array.isArray(contentMetadata.metadataRows)
        ? contentMetadata.metadataRows
        : Array.isArray(md.metadataRows)
          ? md.metadataRows
          : [];

    // Canal: primeira parte da primeira linha.
    let channelName = '';
    const firstRowParts = rows.length > 0 && Array.isArray(rows[0].metadataParts) ? rows[0].metadataParts : [];
    if (firstRowParts.length > 0) channelName = textOf(firstRowParts[0].text);

    // Data: a última parte com texto da última linha com texto. É string
    // relativa e localizada ("há 2 h") — não existe timestamp absoluto no payload.
    let publishedText = '';
    for (let i = rows.length - 1; i >= 0 && publishedText === ''; i--) {
      const parts = rows[i] && Array.isArray(rows[i].metadataParts) ? rows[i].metadataParts : [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const candidate = textOf(parts[j] && parts[j].text);
        if (candidate !== '') {
          publishedText = candidate;
          break;
        }
      }
    }

    const avatar = avatarFrom(
      dig(md, ['image', 'decoratedAvatarViewModel', 'avatar', 'avatarViewModel', 'image', 'sources']),
    );

    return {
      videoId: id,
      title: textOf(md.title),
      channelName,
      channelAvatarUrl: avatar,
      publishedText,
      thumbnailUrl: 'https://i.ytimg.com/vi/' + id + '/hq720.jpg',
      url: 'https://www.youtube.com/watch?v=' + id,
    };
  }

  /** Card no formato antigo (`videoRenderer`), que ainda aparece em outras superfícies. */
  function fromVideoRenderer(node) {
    const id = node.videoId;
    if (typeof id !== 'string' || id.length === 0) return null;
    if (!node.title && !node.headline) return null;

    const channelName =
      textOf(node.ownerText) || textOf(node.longBylineText) || textOf(node.shortBylineText);

    const legacyThumb = dig(node, [
      'channelThumbnailSupportedRenderers',
      'channelThumbnailWithLinkRenderer',
      'thumbnail',
    ]);
    let avatar = null;
    if (legacyThumb && Array.isArray(legacyThumb.thumbnails) && legacyThumb.thumbnails.length > 0) {
      const last = legacyThumb.thumbnails[legacyThumb.thumbnails.length - 1];
      if (last && typeof last.url === 'string') avatar = last.url;
    }
    if (avatar === null) {
      avatar = avatarFrom(
        dig(node, ['avatar', 'decoratedAvatarViewModel', 'avatar', 'avatarViewModel', 'image', 'sources']),
      );
    }

    return {
      videoId: id,
      title: textOf(node.title) || textOf(node.headline),
      channelName,
      channelAvatarUrl: avatar,
      publishedText: textOf(node.publishedTimeText),
      thumbnailUrl: 'https://i.ytimg.com/vi/' + id + '/hq720.jpg',
      url: 'https://www.youtube.com/watch?v=' + id,
    };
  }

  function walk(node) {
    if (cards.length >= limit) return;
    if (node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i]);
      return;
    }

    // Não descer em anúncio, Shorts ou Reel: não são vídeos do feed, e um
    // anúncio chega a se parecer com um card comum por fora.
    if (node.adSlotRenderer || node.shortsLockupViewModel || node.reelItemRenderer) return;

    const card = fromLockup(node) || fromVideoRenderer(node);
    if (card !== null) {
      if (seen[card.videoId] !== true) {
        seen[card.videoId] = true;
        cards.push(card);
      }
      return; // não descer dentro de um card já reconhecido
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) walk(node[keys[i]]);
  }

  walk(source);

  let buildLabel = null;
  try {
    if (typeof window !== 'undefined' && window.ytcfg && typeof window.ytcfg.get === 'function') {
      const label = window.ytcfg.get('PAGE_BUILD_LABEL');
      if (typeof label === 'string') buildLabel = label;
    }
  } catch (error) {
    buildLabel = null;
  }

  return { ok: true, reason: null, cards, buildLabel };
}

/**
 * Extrai o `ytInitialData` embutido no HTML da página — o mesmo JSON que a
 * página usa. Devolve `null` quando o marcador não existe ou o JSON não fecha.
 * É a rota sem aba: o service worker busca o HTML e entrega o objeto aqui.
 */
export function parseInitialDataFromHtml(html) {
  if (typeof html !== 'string') return null;
  const at = html.indexOf('ytInitialData = ');
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
