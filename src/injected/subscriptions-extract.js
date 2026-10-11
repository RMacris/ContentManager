/**
 * Extração das inscrições do YouTube.
 *
 * ATENÇÃO, REGRA DESTE ARQUIVO: as funções aqui são **serializadas** e injetadas
 * no mundo MAIN da página, como as do `feed-extract`. Lá dentro não existe escopo
 * de módulo, `import`, nem qualquer variável deste arquivo. A função tem que ser
 * autossuficiente.
 *
 * A página `/feed/channels` embute a grade de inscrições no `ytInitialData` — o
 * mesmo caminho JSON-first da colheita do feed (ticket 04): o DOM lazy-carrega e o
 * JSON tem tudo. A forma de cada canal é o `channelRenderer` (medido num resultado
 * de busca, 11/10/2026): `channelId`, `title`, o handle em
 * `navigationEndpoint.browseEndpoint.canonicalBaseUrl` e a contagem em
 * `videoCountText` — com `subscriberCountText` às vezes carregando o `@handle`.
 *
 * O leitor é **tolerante à forma**: qualquer nó com `channelId` (ou `contentId`) de
 * canal e título conta como inscrição. Forma que o YouTube mudar deixa de ser
 * reconhecida — e o resultado vazio denuncia, em vez de inventar canais.
 *
 * @param {number} maxChannels teto de canais — a grade vem inteira, o teto só
 *   protege contra uma página patológica.
 * @param {object|null} data JSON já pronto (teste); na página, `null` faz a
 *   função ler `window.ytInitialData`.
 */
export function extractSubscriptions(maxChannels, data = null) {
  const source =
    data && typeof data === 'object'
      ? data
      : typeof window !== 'undefined'
        ? window.ytInitialData
        : null;
  if (!source || typeof source !== 'object') {
    return { ok: false, reason: 'ytInitialData ausente', channels: [], hasMore: false };
  }

  const limit = typeof maxChannels === 'number' && maxChannels > 0 ? maxChannels : 1000;
  const channels = [];
  const seen = Object.create(null);
  let hasMore = false;

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
    return typeof current === 'string' && current !== '' ? current : null;
  }

  /** `/@handle` (ou uma URL de comando com `@`) vira `handle`, sem o `@`. */
  function handleOfUrl(url) {
    if (typeof url !== 'string') return null;
    const match = /(?:^|\/)@([^\s/?#]+)/.exec(url);
    return match === null ? null : match[1];
  }

  function handleFrom(node) {
    const fromUrl =
      handleOfUrl(dig(node, ['navigationEndpoint', 'browseEndpoint', 'canonicalBaseUrl'])) ??
      handleOfUrl(dig(node, ['navigationEndpoint', 'commandMetadata', 'webCommandMetadata', 'url']));
    if (fromUrl !== null) return fromUrl;

    // Medido: no renderer de busca o `subscriberCountText` guarda o `@handle`.
    const byText = textOf(node.subscriberCountText);
    const match = /^@([^\s]+)$/.exec(byText);
    return match === null ? null : match[1];
  }

  /** A contagem de inscritos: o texto que se declara como tal, onde ele estiver. */
  function subscribersFrom(node) {
    const candidates = [textOf(node.videoCountText), textOf(node.subscriberCountText)];
    for (let i = 0; i < candidates.length; i++) {
      if (/inscrito|subscriber/i.test(candidates[i])) return candidates[i];
    }
    return null;
  }

  /** O maior avatar disponível — a lista os mostra em miniatura de 24–32 px. */
  function avatarFrom(node) {
    if (!node.thumbnail || !Array.isArray(node.thumbnail.thumbnails)) return null;
    const thumbnails = node.thumbnail.thumbnails;
    const last = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1] : null;
    if (!last || typeof last.url !== 'string' || last.url === '') return null;
    return last.url.startsWith('//') ? `https:${last.url}` : last.url;
  }

  /** O nó é uma inscrição? Exige id de canal e título — o resto é tolerante. */
  function channelEntry(node) {
    let id = null;
    if (typeof node.channelId === 'string' && /^UC[\w-]{22}$/.test(node.channelId)) id = node.channelId;
    else if (typeof node.contentId === 'string' && /^UC[\w-]{22}$/.test(node.contentId)) id = node.contentId;
    if (id === null) return null;

    const title = textOf(node.title);
    if (title === '') return null;

    return {
      channelId: id,
      handle: handleFrom(node),
      title,
      avatarUrl: avatarFrom(node),
      subscribersText: subscribersFrom(node),
    };
  }

  function walk(node) {
    if (node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i]);
      return;
    }

    // A página inteira é varrida mesmo depois do teto: é como a continuação é
    // avistada quando a grade não veio completa no JSON inicial.
    if (node.continuationItemRenderer) hasMore = true;

    const channel = channelEntry(node);
    if (channel !== null) {
      if (seen[channel.channelId] !== true) {
        seen[channel.channelId] = true;
        if (channels.length < limit) channels.push(channel);
      }
      return; // não descer dentro de um canal já reconhecido
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) walk(node[keys[i]]);
  }

  walk(source);

  return { ok: true, reason: null, channels, hasMore };
}
