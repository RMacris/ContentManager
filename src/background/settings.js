/**
 * Configurações da extensão.
 *
 * A extensão é autônoma: nada daqui sai da máquina. As preferências do filtro
 * do YouTube moram em `chrome.storage.sync`, porque acompanham o perfil.
 *
 * O schema (padrões, limites, chaves e normalização) mora em
 * `shared/settings-contract.js`, o mesmo módulo que o popup carrega. Aqui fica
 * a autoridade da gravação: ler, validar contra o contrato e persistir.
 */
import '../content/keyword-core.js';
import '../content/channel-rules.js';
import '../shared/settings-contract.js';

const contract = globalThis.YTISettingsContract;
const MIN_MAX_AGE_HOURS = contract.LIMITS.maxAgeHours.min;
const MAX_MAX_AGE_HOURS = contract.LIMITS.maxAgeHours.max;

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

/** Os padrões vêm do contrato; a gravação não mantém uma segunda cópia. */
export const DEFAULT_SETTINGS = contract.DEFAULT_SETTINGS;

const LIST_KEYS = contract.LIST_KEYS;
const ALLOWED_LIST_KEY = contract.ALLOWED_LIST_KEY;

/**
 * Grava a lista de IA na primeira leitura. Depois disso a lista pertence ao
 * usuário: nunca é sobrescrita, nem quando a extensão atualiza.
 */
export async function initializeKeywordLists() {
  const saved = await chrome.storage.sync.get({ blockedKeywords: null });
  if (contract.normalizeList(saved.blockedKeywords) === null) {
    await chrome.storage.sync.set({ blockedKeywords: [...PRESET_AI_KEYWORDS] });
  }
}

export async function getSettings() {
  await initializeKeywordLists();
  const saved = await chrome.storage.sync.get({
    ...DEFAULT_SETTINGS,
    // `null` revela se a chave existe; o padrão esconderia a migração.
    maxAgeHours: null,
    [contract.LEGACY_AGE_KEY]: null,
    blockedKeywords: null,
    blockedChannels: null,
    allowedChannels: null,
  });
  const settings = contract.normalizeSettings(saved);

  // Grava a idade em horas na primeira leitura, convertendo a chave antiga em
  // dias uma única vez. Depois disso a extensão só lê `maxAgeHours`.
  if (!contract.isValidMaxAgeHours(saved.maxAgeHours)) {
    await chrome.storage.sync.set({ maxAgeHours: settings.maxAgeHours });
  }

  return settings;
}

export async function saveSettings(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('As configurações enviadas são inválidas.');
  }

  const unknownKey = Object.keys(patch).find((key) => !contract.isKnownKey(key));
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

  if (Object.prototype.hasOwnProperty.call(patch, 'maxAgeHours')) {
    const maxAgeHours = Number(patch.maxAgeHours);
    if (!contract.isValidMaxAgeHours(maxAgeHours)) {
      throw new RangeError(
        `O limite deve ser um número inteiro entre ${MIN_MAX_AGE_HOURS} e ${MAX_MAX_AGE_HOURS} horas.`,
      );
    }
    validated.maxAgeHours = maxAgeHours;
  }

  for (const key of LIST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      validated[key] = contract.normalizeListForSave(patch[key]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, ALLOWED_LIST_KEY)) {
    validated[ALLOWED_LIST_KEY] = contract.normalizeAllowedForSave(patch[ALLOWED_LIST_KEY]);
  }

  if (Object.keys(validated).length > 0) await chrome.storage.sync.set(validated);
  return getSettings();
}