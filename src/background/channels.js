/**
 * Catálogo dos canais inscritos, lido da página `youtube.com/feed/channels`.
 *
 * O content script manda o que encontrou nos cards de canal; o service worker
 * grava em `chrome.storage.local` (a lista pode ter centenas de canais com
 * foto, o que não cabe no `sync`) e mescla com o que já estava guardado — assim
 * rolar a página acumula a lista inteira em vez de apagar o que não apareceu.
 *
 * A identidade de um canal é a de `channel-rules.js`: handle normalizado quando
 * os dois registros têm handle, senão o nome normalizado. O catálogo não
 * mantém uma segunda regra: dois cards do mesmo canal, um com handle e outro
 * sem, viram uma linha só — a mesma que a allowlist trata como um canal só.
 *
 * A allowlist em si (`allowedChannels`) mora no `sync`, junto das outras
 * preferências, e guarda só nome e handle: a foto é resolvida aqui na hora de
 * renderizar a badge no popup.
 */
import '../content/keyword-core.js';
import '../content/channel-rules.js';

const channelRules = globalThis.YTIChannelRules;

const CATALOG_KEY = 'channelCatalog';
const MAX_CATALOG_CHANNELS = 2000;
// O mesmo teto que a allowlist aceita: uma sugestão do catálogo sempre pode
// ser salva, em vez de aparecer na busca e falhar no clique.
const MAX_NAME_LENGTH = channelRules.MAX_CHANNEL_NAME_LENGTH;
const MAX_HANDLE_LENGTH = channelRules.MAX_CHANNEL_NAME_LENGTH;
const MAX_AVATAR_LENGTH = 500;

export async function getChannelCatalog() {
  const stored = await readStoredCatalog();
  return { updatedAt: stored.updatedAt, channels: buildCatalog(stored.channels).entries };
}

export async function saveChannelCatalog(channels) {
  if (!Array.isArray(channels)) {
    throw new TypeError('A lista de canais precisa ser enviada como uma lista.');
  }

  const stored = await readStoredCatalog();
  const catalog = buildCatalog(stored.channels);
  for (let i = 0; i < channels.length; i += 1) catalog.put(channels[i]);

  const list = catalog.entries.slice(0, MAX_CATALOG_CHANNELS);
  const saved = { updatedAt: Date.now(), channels: list };
  await chrome.storage.local.set({ [CATALOG_KEY]: saved });
  return saved;
}

async function readStoredCatalog() {
  const stored = await chrome.storage.local.get({ [CATALOG_KEY]: null });
  const catalog = stored[CATALOG_KEY];
  if (catalog === null || typeof catalog !== 'object' || !Array.isArray(catalog.channels)) {
    return { updatedAt: 0, channels: [] };
  }
  return { updatedAt: Number(catalog.updatedAt) || 0, channels: catalog.channels };
}

/**
 * A lista sem repetidos, pela identidade do `channel-rules`. Os índices por
 * handle e por nome evitam comparar cada entrada nova com as duas mil
 * guardadas; a decisão final continua sendo `sameChannel`, que sabe que dois
 * handles diferentes não são o mesmo canal mesmo com o nome igual.
 */
function buildCatalog(initial) {
  const entries = [];
  const byHandle = new Map();
  const byName = new Map();

  function index(entry) {
    const handle = channelRules.normalizeHandle(entry.handle);
    if (handle !== '') byHandle.set(handle, entry);

    const name = channelRules.normalizeChannelName(entry.name);
    if (name === '') return;
    const sameName = byName.get(name);
    if (sameName === undefined) byName.set(name, [entry]);
    else sameName.push(entry);
  }

  function unindex(entry) {
    const handle = channelRules.normalizeHandle(entry.handle);
    if (handle !== '') byHandle.delete(handle);

    const name = channelRules.normalizeChannelName(entry.name);
    const sameName = byName.get(name);
    if (sameName === undefined) return;
    const index = sameName.indexOf(entry);
    if (index !== -1) sameName.splice(index, 1);
    if (sameName.length === 0) byName.delete(name);
  }

  function findSame(clean) {
    const handle = channelRules.normalizeHandle(clean.handle);
    const name = channelRules.normalizeChannelName(clean.name);
    const candidates = [];
    if (handle !== '') {
      const found = byHandle.get(handle);
      if (found !== undefined) candidates.push(found);
    }
    if (name !== '') {
      const found = byName.get(name);
      if (found !== undefined) {
        for (let i = 0; i < found.length; i += 1) {
          if (candidates.indexOf(found[i]) === -1) candidates.push(found[i]);
        }
      }
    }

    for (let i = 0; i < candidates.length; i += 1) {
      if (channelRules.sameChannel(candidates[i], clean)) return candidates[i];
    }
    return null;
  }

  function put(value) {
    const clean = normalizeEntry(value);
    if (clean === null) return;

    const match = findSame(clean);
    if (match === null) {
      entries.push(clean);
      index(clean);
      return;
    }

    unindex(match);
    match.name = clean.name;
    match.handle = clean.handle || match.handle;
    match.avatarUrl = clean.avatarUrl || match.avatarUrl;
    index(match);
  }

  for (let i = 0; i < initial.length; i += 1) put(initial[i]);
  return { entries, put };
}

/** Aceita só o que dá para usar na UI; a foto vira URL absoluta https. */
function normalizeEntry(entry) {
  if (entry === null || typeof entry !== 'object') return null;

  const name = typeof entry.name === 'string' ? channelRules.cleanText(entry.name) : '';
  if (name === '' || name.length > MAX_NAME_LENGTH) return null;

  const handle = typeof entry.handle === 'string' ? channelRules.cleanText(entry.handle) : '';
  const avatarUrl = typeof entry.avatarUrl === 'string' ? entry.avatarUrl.trim() : '';

  return {
    name,
    handle: handle.slice(0, MAX_HANDLE_LENGTH),
    avatarUrl: normalizeAvatar(avatarUrl),
  };
}

/** O card do YouTube manda `//yt3...`; em página de extensão isso quebraria. */
function normalizeAvatar(value) {
  if (value === '' || value.length > MAX_AVATAR_LENGTH) return '';
  if (value.startsWith('//')) return 'https:' + value;
  if (/^https?:\/\//.test(value)) return value;
  return '';
}
