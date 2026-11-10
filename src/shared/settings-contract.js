/**
 * Contrato das configurações da extensão.
 *
 * Dono único dos padrões, limites, chaves e normalização. Script clássico de
 * propósito: o popup o carrega depois de `keyword-core.js` e
 * `channel-rules.js` e antes de `popup.js`; os content scripts o carregam
 * depois de `channel-rules.js`, e o `background/settings.js` importa o mesmo
 * arquivo e lê a API pelo global.
 *
 * Nada aqui toca `chrome` nem o DOM: a tela é um adaptador e a persistência
 * (ler, validar e gravar) continua em `background/settings.js`. A igualdade
 * das listas continua em `channel-rules.js` (C1), que este contrato chama
 * para não manter uma segunda regra de deduplicação.
 */
(function (root) {
  'use strict';

  const HOURS_PER_DAY = 24;

  const DEFAULT_SETTINGS = Object.freeze({
    hideOldVideos: true,
    hideGamesAndAds: true,
    maxAgeHours: 72,
    blockKeywords: false,
  });

  /** Os limites que a tela mostra e que a gravação aceita. */
  const LIMITS = Object.freeze({
    maxAgeHours: Object.freeze({ min: 1, max: 365 * HOURS_PER_DAY }),
    maxListItems: 100,
    maxItemLength: 60,
    maxAllowedChannels: 50,
  });

  /** A chave antiga, em dias: só é lida para migrar o que já estava gravado. */
  const LEGACY_AGE_KEY = 'maxAgeDays';
  const LEGACY_MAX_AGE_DAYS = Object.freeze({ min: 1, max: 365 });

  const LIST_KEYS = Object.freeze(['blockedKeywords', 'blockedChannels']);
  const ALLOWED_LIST_KEY = 'allowedChannels';
  const SETTING_KEYS = Object.freeze([
    ...Object.keys(DEFAULT_SETTINGS),
    ...LIST_KEYS,
    ALLOWED_LIST_KEY,
  ]);

  /** As regras de lista chegam de `channel-rules.js`, carregado antes. */
  function channelRules() {
    const rules = typeof root.YTIChannelRules !== 'undefined' ? root.YTIChannelRules : null;
    if (rules === null) {
      throw new Error('settings-contract: carregue channel-rules.js antes deste arquivo.');
    }
    return rules;
  }

  function isKnownKey(key) {
    return typeof key === 'string' && SETTING_KEYS.includes(key);
  }

  function isValidMaxAgeHours(value) {
    return (
      Number.isInteger(value) &&
      value >= LIMITS.maxAgeHours.min &&
      value <= LIMITS.maxAgeHours.max
    );
  }

  function isValidLegacyMaxAgeDays(value) {
    return (
      Number.isInteger(value) &&
      value >= LEGACY_MAX_AGE_DAYS.min &&
      value <= LEGACY_MAX_AGE_DAYS.max
    );
  }

  /**
   * A idade canônica é em horas. Sem uma quantidade de horas válida, aproveita
   * a chave antiga em dias — é assim que quem já usava a extensão mantém o
   * limite que escolheu depois da atualização.
   */
  function normalizeMaxAgeHours(value, legacyDays) {
    if (isValidMaxAgeHours(value)) return value;
    if (isValidLegacyMaxAgeDays(legacyDays)) return legacyDays * HOURS_PER_DAY;
    return DEFAULT_SETTINGS.maxAgeHours;
  }

  /** `null` quando a lista nunca foi gravada; senão, a lista limpa e sem repetidos. */
  function normalizeList(value) {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) return null;
    return channelRules().normalizeList(value);
  }

  /** `null` quando a allowlist nunca foi gravada; senão, nome e handle limpos. */
  function normalizeAllowedList(value) {
    if (!Array.isArray(value)) return null;
    return channelRules().normalizeAllowed(value);
  }

  /**
   * O estado completo como a extensão o consome: padrões para o que faltar,
   * interruptores coagidos e listas sempre como arrays.
   */
  function normalizeSettings(value) {
    const saved = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      hideOldVideos: saved.hideOldVideos !== false,
      hideGamesAndAds: saved.hideGamesAndAds !== false,
      maxAgeHours: normalizeMaxAgeHours(saved.maxAgeHours, saved[LEGACY_AGE_KEY]),
      blockKeywords: saved.blockKeywords === true,
      blockedKeywords: normalizeList(saved.blockedKeywords) ?? [],
      blockedChannels: normalizeList(saved.blockedChannels) ?? [],
      allowedChannels: normalizeAllowedList(saved.allowedChannels) ?? [],
    };
  }

  /** A lista como o usuário a enviou: validada, aparada e dentro do limite. */
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
    const tooLong = trimmed.find((item) => item.length > LIMITS.maxItemLength);
    if (tooLong !== undefined) {
      throw new RangeError(
        `Cada item da lista precisa ter até ${LIMITS.maxItemLength} caracteres.`,
      );
    }

    const unique = channelRules().normalizeList(value);
    if (unique.length > LIMITS.maxListItems) {
      throw new RangeError(`A lista comporta até ${LIMITS.maxListItems} itens.`);
    }
    return unique;
  }

  /** A allowlist do popup: nome + handle, sem repetidos e dentro do limite. */
  function normalizeAllowedForSave(value) {
    if (!Array.isArray(value)) {
      throw new TypeError('A lista de sempre recomendados precisa ser enviada como uma lista.');
    }

    const cleaned = [];
    for (const entry of value) {
      if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') {
        throw new TypeError('Cada canal precisa ter um nome.');
      }
      const name = entry.name.trim();
      if (name === '') continue;
      if (name.length > LIMITS.maxItemLength) {
        throw new RangeError(
          `O nome do canal precisa ter até ${LIMITS.maxItemLength} caracteres.`,
        );
      }

      const handle = typeof entry.handle === 'string' ? entry.handle.trim() : '';
      if (handle.length > LIMITS.maxItemLength) {
        throw new RangeError(
          `O handle do canal precisa ter até ${LIMITS.maxItemLength} caracteres.`,
        );
      }

      cleaned.push({ name, handle });
    }

    const unique = channelRules().normalizeAllowed(cleaned);
    if (unique.length > LIMITS.maxAllowedChannels) {
      throw new RangeError(
        `A lista de sempre recomendados comporta até ${LIMITS.maxAllowedChannels} canais.`,
      );
    }
    return unique;
  }

  root.YTISettingsContract = Object.freeze({
    DEFAULT_SETTINGS,
    LIMITS,
    HOURS_PER_DAY,
    LEGACY_AGE_KEY,
    LIST_KEYS,
    ALLOWED_LIST_KEY,
    SETTING_KEYS,
    isKnownKey,
    isValidMaxAgeHours,
    normalizeMaxAgeHours,
    normalizeSettings,
    normalizeList,
    normalizeAllowedList,
    normalizeListForSave,
    normalizeAllowedForSave,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
