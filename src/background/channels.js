/**
 * Catálogo dos canais inscritos, lido da página `youtube.com/feed/channels`.
 *
 * O content script manda o que encontrou nos cards de canal; o service worker
 * grava em `chrome.storage.local` (a lista pode ter centenas de canais com
 * foto, o que não cabe no `sync`) e mescla com o que já estava guardado — assim
 * rolar a página acumula a lista inteira em vez de apagar o que não apareceu.
 *
 * A allowlist em si (`allowedChannels`) mora no `sync`, junto das outras
 * preferências, e guarda só nome e handle: a foto é resolvida aqui na hora de
 * renderizar a badge no popup.
 */
const CATALOG_KEY = 'channelCatalog';
const MAX_CATALOG_CHANNELS = 2000;
const MAX_NAME_LENGTH = 100;
const MAX_HANDLE_LENGTH = 100;
const MAX_AVATAR_LENGTH = 500;

export async function getChannelCatalog() {
  const stored = await chrome.storage.local.get({ [CATALOG_KEY]: null });
  const catalog = stored[CATALOG_KEY];
  if (catalog === null || typeof catalog !== 'object' || !Array.isArray(catalog.channels)) {
    return { updatedAt: 0, channels: [] };
  }
  return {
    updatedAt: Number(catalog.updatedAt) || 0,
    channels: catalog.channels.filter((entry) => normalizeEntry(entry) !== null).map(normalizeEntry),
  };
}

export async function saveChannelCatalog(channels) {
  if (!Array.isArray(channels)) {
    throw new TypeError('A lista de canais precisa ser enviada como uma lista.');
  }

  const merged = new Map();
  const put = (entry) => {
    const clean = normalizeEntry(entry);
    if (clean === null) return;
    merged.set(catalogKey(clean), clean);
  };

  const current = await getChannelCatalog();
  current.channels.forEach(put);
  channels.forEach(put);

  const list = Array.from(merged.values()).slice(0, MAX_CATALOG_CHANNELS);
  const catalog = { updatedAt: Date.now(), channels: list };
  await chrome.storage.local.set({ [CATALOG_KEY]: catalog });
  return catalog;
}

function catalogKey(entry) {
  return (entry.handle || entry.name).toLowerCase();
}

/** Aceita só o que dá para usar na UI; a foto vira URL absoluta https. */
function normalizeEntry(entry) {
  if (entry === null || typeof entry !== 'object') return null;

  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (name === '' || name.length > MAX_NAME_LENGTH) return null;

  const handle = typeof entry.handle === 'string' ? entry.handle.trim() : '';
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
