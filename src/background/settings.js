/**
 * Configurações da extensão.
 *
 * A extensão é autônoma: nada daqui sai da máquina. As preferências do filtro
 * do YouTube moram em `chrome.storage.sync`, porque acompanham o perfil.
 */

export const MIN_MAX_AGE_DAYS = 1;
export const MAX_MAX_AGE_DAYS = 365;
export const MAX_LIST_ITEMS = 100;
export const MAX_ITEM_LENGTH = 60;

/**
 * As palavras-chave que já vêm com a extensão: os termos conhecidos de IA,
 * em pt e en. Elas são gravadas na primeira leitura como lista editável — o
 * usuário estende, remove e reordena como quiser no popup.
 */
export const PRESET_AI_KEYWORDS = [
  'inteligência artificial',
  'artificial intelligence',
  'IA',
  'AI',
  'ChatGPT',
  'Chat GPT',
  'GPT-4',
  'GPT-4o',
  'GPT-5',
  'OpenAI',
  'Open AI',
  'Claude',
  'Anthropic',
  'Gemini',
  'DeepSeek',
  'Grok',
  'Llama',
  'Mistral',
  'Qwen',
  'Copilot',
  'Midjourney',
  'Stable Diffusion',
  'Sora',
  'Kling',
  'Veo 3',
  'Runway',
  'LLM',
  'LLMs',
  'Machine Learning',
  'Aprendizado de Máquina',
  'Deep Learning',
  'Rede Neural',
  'Redes Neurais',
  'Neural Network',
  'IA Generativa',
  'Gen AI',
  'Generative AI',
  'Agentes de IA',
  'Agente de IA',
  'AI Agents',
  'AI Agent',
  'Prompt Engineering',
  'Engenharia de Prompt',
  'Vibe Coding',
];

export const DEFAULT_SETTINGS = {
  /**
   * Esconder no YouTube os vídeos mais antigos que `maxAgeDays` (3 dias por
   * padrão).
   */
  hideOldVideos: true,
  /**
   * Esconder os cards que não têm data para julgar: o jogo da prateleira de
   * playables e o anúncio no feed.
   */
  hideGamesAndAds: true,
  /** Idade máxima das recomendações antes de serem ocultadas. */
  maxAgeDays: 3,
  /**
   * Esconder o vídeo cujo título tem uma das `blockedKeywords` ou cujo canal
   * está em `blockedChannels`. Desligado por padrão: é o usuário quem ativa.
   */
  blockKeywords: false,
};

const LIST_KEYS = ['blockedKeywords', 'blockedChannels'];
const ALLOWED_LIST_KEY = 'allowedChannels';
export const MAX_ALLOWED_CHANNELS = 50;

/**
 * Grava a lista de IA na primeira leitura. Depois disso a lista pertence ao
 * usuário: nunca é sobrescrita, nem quando a extensão atualiza.
 */
export async function initializeKeywordLists() {
  const saved = await chrome.storage.sync.get({ blockedKeywords: null });
  if (normalizeList(saved.blockedKeywords) === null) {
    await chrome.storage.sync.set({ blockedKeywords: [...PRESET_AI_KEYWORDS] });
  }
}

export async function getSettings() {
  await initializeKeywordLists();
  const saved = await chrome.storage.sync.get({
    ...DEFAULT_SETTINGS,
    blockedKeywords: null,
    blockedChannels: null,
    allowedChannels: null,
  });
  return {
    hideOldVideos: saved.hideOldVideos !== false,
    hideGamesAndAds: saved.hideGamesAndAds !== false,
    maxAgeDays: normalizeMaxAgeDays(saved.maxAgeDays),
    blockKeywords: saved.blockKeywords === true,
    blockedKeywords: normalizeList(saved.blockedKeywords) ?? [],
    blockedChannels: normalizeList(saved.blockedChannels) ?? [],
    allowedChannels: normalizeAllowedList(saved.allowedChannels) ?? [],
  };
}

export async function saveSettings(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('As configurações enviadas são inválidas.');
  }

  const allowedKeys = [...Object.keys(DEFAULT_SETTINGS), ...LIST_KEYS, ALLOWED_LIST_KEY];
  const unknownKey = Object.keys(patch).find((key) => !allowedKeys.includes(key));
  if (unknownKey !== undefined) throw new Error(`Configuração desconhecida: ${unknownKey}.`);

  const validated = {};
  for (const key of ['hideOldVideos', 'hideGamesAndAds', 'blockKeywords']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      if (typeof patch[key] !== 'boolean') {
        throw new TypeError('O valor do interruptor deve ser verdadeiro ou falso.');
      }
      validated[key] = patch[key];
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'maxAgeDays')) {
    const maxAgeDays = Number(patch.maxAgeDays);
    if (!isValidMaxAgeDays(maxAgeDays)) {
      throw new RangeError(
        `O limite deve ser um número inteiro entre ${MIN_MAX_AGE_DAYS} e ${MAX_MAX_AGE_DAYS} dias.`,
      );
    }
    validated.maxAgeDays = maxAgeDays;
  }

  for (const key of LIST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      validated[key] = normalizeListForSave(patch[key]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, ALLOWED_LIST_KEY)) {
    validated[ALLOWED_LIST_KEY] = normalizeAllowedForSave(patch[ALLOWED_LIST_KEY]);
  }

  if (Object.keys(validated).length > 0) await chrome.storage.sync.set(validated);
  return getSettings();
}

function normalizeMaxAgeDays(value) {
  return isValidMaxAgeDays(value) ? value : DEFAULT_SETTINGS.maxAgeDays;
}

function isValidMaxAgeDays(value) {
  return Number.isInteger(value) && value >= MIN_MAX_AGE_DAYS && value <= MAX_MAX_AGE_DAYS;
}

/** `null` quando a lista nunca foi gravada; senão, a lista limpa. */
function normalizeList(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  return value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

/** A lista como o usuário a enviou: aparada, sem repetidos e dentro do limite. */
function normalizeListForSave(value) {
  if (!Array.isArray(value)) {
    throw new TypeError('A lista precisa ser enviada como uma lista de textos.');
  }
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new TypeError('Cada item da lista precisa ser um texto.');
    }
  }
  const trimmed = value.map((item) => item.trim());
  const tooLong = trimmed.find((item) => item.length > MAX_ITEM_LENGTH);
  if (tooLong !== undefined) {
    throw new RangeError(`Cada item da lista precisa ter até ${MAX_ITEM_LENGTH} caracteres.`);
  }

  const seen = new Set();
  const unique = [];
  for (const item of trimmed) {
    if (item === '') continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  if (unique.length > MAX_LIST_ITEMS) {
    throw new RangeError(`A lista comporta até ${MAX_LIST_ITEMS} itens.`);
  }
  return unique;
}

/** `null` quando a allowlist nunca foi gravada; senão, nome e handle limpos. */
function normalizeAllowedList(value) {
  if (!Array.isArray(value)) return null;
  const list = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name === '') continue;
    const handle = typeof entry.handle === 'string' ? entry.handle.trim() : '';
    list.push({ name, handle });
  }
  return list;
}

/** A allowlist do popup: nome + handle, sem repetidos e dentro do limite. */
function normalizeAllowedForSave(value) {
  if (!Array.isArray(value)) {
    throw new TypeError('A lista de sempre recomendados precisa ser enviada como uma lista.');
  }

  const seen = new Set();
  const unique = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') {
      throw new TypeError('Cada canal precisa ter um nome.');
    }
    const name = entry.name.trim();
    if (name === '') continue;
    if (name.length > MAX_ITEM_LENGTH) {
      throw new RangeError(`O nome do canal precisa ter até ${MAX_ITEM_LENGTH} caracteres.`);
    }

    const handle = typeof entry.handle === 'string' ? entry.handle.trim() : '';
    if (handle.length > MAX_ITEM_LENGTH) {
      throw new RangeError(`O handle do canal precisa ter até ${MAX_ITEM_LENGTH} caracteres.`);
    }

    const key = (handle || name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ name, handle });
  }

  if (unique.length > MAX_ALLOWED_CHANNELS) {
    throw new RangeError(`A lista de sempre recomendados comporta até ${MAX_ALLOWED_CHANNELS} canais.`);
  }
  return unique;
}
