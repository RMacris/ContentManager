/**
 * Contrato das configurações da extensão.
 *
 * Dono único dos padrões, limites, chaves e normalização. Script clássico de
 * propósito: o popup o carrega depois de `keyword-core.js` e
 * `channel-rules.js` e antes de `popup.js`; o `background/settings.js` importa
 * o mesmo arquivo e lê a API pelo global.
 *
 * Nada aqui toca `chrome` nem o DOM: a tela é um adaptador e a persistência
 * (ler, validar e gravar) continua em `background/settings.js`. A igualdade
 * das listas continua em `channel-rules.js` (C1), que este contrato chama
 * para não manter uma segunda regra de deduplicação.
 */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    hideOldVideos: true,
    hideGamesAndAds: true,
    maxAgeDays: 3,
    blockKeywords: false,
  });

  /** Os limites que a tela mostra e que a gravação aceita. */
  const LIMITS = Object.freeze({
    maxAgeDays: Object.freeze({ min: 1, max: 365 }),
    maxListItems: 100,
    maxItemLength: 60,
    maxAllowedChannels: 50,
  });

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

  function isValidMaxAgeDays(value) {
    return (
      Number.isInteger(value) &&
      value >= LIMITS.maxAgeDays.min &&
      value <= LIMITS.maxAgeDays.max
    );
  }

  function normalizeMaxAgeDays(value) {
    return isValidMaxAgeDays(value) ? value : DEFAULT_SETTINGS.maxAgeDays;
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

  /** O candidato já está na lista pela regra do casamento? */
  function hasListItem(values, candidate) {
    return channelRules().hasListItem(values, candidate);
  }

  /** Dois registros da allowlist são o mesmo canal? */
  function sameChannel(a, b) {
    return channelRules().sameChannel(a, b);
  }

  root.YTISettingsContract = Object.freeze({
    DEFAULT_SETTINGS,
    LIMITS,
    LIST_KEYS,
    ALLOWED_LIST_KEY,
    SETTING_KEYS,
    isKnownKey,
    isValidMaxAgeDays,
    normalizeMaxAgeDays,
    normalizeList,
    normalizeAllowedList,
    normalizeListForSave,
    normalizeAllowedForSave,
    hasListItem,
    sameChannel,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
