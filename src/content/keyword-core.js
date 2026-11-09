/**
 * Casamento de palavras-chave e nomes de canal nos cards do YouTube.
 *
 * Script clássico de propósito: o Chrome carrega este arquivo junto do
 * `age-filter.js` na mesma execução do content script, sem `import`/`export` —
 * o filtro lê a API daqui pelo global. O arquivo é puro (sem DOM e sem
 * `chrome`) para a suíte rodá-lo no Node.
 *
 * A comparação é sobre texto normalizado: minúsculo, sem acento e sem
 * pontuação — "ChatGPT-4o", "chatgpt 4o" e "CHATGPT 4O" são a mesma coisa.
 * A lista de palavras-chave mora nas configurações (`blockedKeywords`), não
 * aqui; este arquivo só sabe casar texto.
 */
(function (root) {
  'use strict';

  /**
   * O texto como uma sequência de palavras: minúsculo, sem acento, sem
   * zero-width e com a pontuação virada em espaço — o hífen de "GPT-4" vira
   * "gpt 4", então a forma com e sem hífen casam igual.
   */
  function normalizeText(text) {
    if (typeof text !== 'string') return '';
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * O título tem alguma das palavras-chave? A comparação é por palavra
   * inteira: "ia" não casa com "pianista", mas casa com "eu ia assistir".
   */
  function matchesKeyword(text, keywords) {
    const haystack = normalizeText(text);
    if (haystack === '') return false;
    if (!Array.isArray(keywords)) return false;
    const padded = ' ' + haystack + ' ';
    for (let i = 0; i < keywords.length; i += 1) {
      const needle = normalizeText(keywords[i]);
      if (needle !== '' && padded.includes(' ' + needle + ' ')) return true;
    }
    return false;
  }

  /**
   * O nome do canal é um dos bloqueados? Aqui basta conter: o card escreve
   * "Canal X - Ao vivo" e o dono da lista digitou "Canal X".
   */
  function matchesChannel(text, channels) {
    const haystack = normalizeText(text);
    if (haystack === '') return false;
    if (!Array.isArray(channels)) return false;
    for (let i = 0; i < channels.length; i += 1) {
      const needle = normalizeText(channels[i]);
      if (needle !== '' && haystack.includes(needle)) return true;
    }
    return false;
  }

  root.YTIKeywordFilter = {
    normalizeText,
    matchesKeyword,
    matchesChannel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
