/**
 * Regras das listas de canais: normalização, identidade e casamento.
 *
 * Script clássico de propósito: o Chrome carrega este arquivo depois de
 * `keyword-core.js` e antes de `youtube-dom.js`, `content-runtime.js`,
 * `channel-button.js` e `age-filter.js`; o popup e o `background/settings.js`
 * leem a mesma API pelo global. O arquivo é puro (sem DOM e sem `chrome`) para
 * a suíte rodá-lo no Node.
 *
 * Este é o único dono da política das listas:
 *  - o texto do canal é normalizado pelo `keyword-core` (minúsculo, sem
 *    acento e sem pontuação), então "GPT-4" e "gpt 4" são a mesma entrada;
 *  - a identidade do canal é o handle sem `@` e em minúsculas, ou o nome
 *    normalizado;
 *  - a allowlist e a blocklist casam por essa identidade;
 *  - o clique no botão calcula a próxima lista de bloqueados.
 *
 * Os consumidores — filtro, chip, catálogo, popup e settings — são adaptadores:
 * só chamam estas funções e não guardam cópia da regra.
 */
(function (root) {
  'use strict';

  // `keyword-core.js` é o dono do casamento de texto e carrega antes deste
  // arquivo em todos os contextos; sem ele não há uma regra única para usar.
  const keywordCore = typeof root.YTIKeywordFilter !== 'undefined' ? root.YTIKeywordFilter : null;
  if (keywordCore === null || keywordCore === undefined) return;

  // O mesmo teto de `background/settings.js`: nome maior não pode ser salvo.
  const MAX_CHANNEL_NAME_LENGTH = 60;

  /** Texto de canal sem zero-width, com espaços colapsados e aparado. */
  function cleanText(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * A forma comparável do nome: a mesma do casamento de palavras-chave. Para
   * um texto que o normalizador ASCII não consegue representar (outro
   * alfabeto, emoji), a comparação cai no texto aparado em minúsculas — assim
   * a entrada não é descartada nem vira uma chave vazia.
   */
  function normalizeChannelName(value) {
    const text = cleanText(value);
    const normalized = keywordCore.normalizeText(text);
    return normalized !== '' ? normalized : text.toLowerCase();
  }

  /** O handle comparável: sem `@`, aparado e em minúsculas. */
  function normalizeHandle(value) {
    return cleanText(value).replace(/^@/, '').toLowerCase();
  }

  /** Extrai o handle de um href de canal (`/@nome` ou URL completa). */
  function handleFromHref(href) {
    if (typeof href !== 'string') return '';
    const match = href.match(/^\/@([^/?#]+)/) || href.match(/youtube\.com\/@([^/?#]+)/);
    if (match === null) return '';
    try {
      return decodeURIComponent(match[1]);
    } catch (error) {
      return match[1];
    }
  }

  /** O nome cabe no limite que o service worker aceita? */
  function isUsableChannelName(value) {
    const text = cleanText(value);
    return text !== '' && text.length <= MAX_CHANNEL_NAME_LENGTH;
  }

  /**
   * A lista de textos como o usuário a enviou: aparada, sem vazios e sem
   * repetidos pela mesma regra do casamento (`GPT-4` e `gpt 4` são um só),
   * preservando a grafia da primeira ocorrência.
   */
  function normalizeList(values) {
    if (!Array.isArray(values)) return [];
    const list = [];
    const seen = new Set();
    for (let i = 0; i < values.length; i += 1) {
      if (typeof values[i] !== 'string') continue;
      const text = values[i].trim();
      const key = normalizeChannelName(text);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      list.push(text);
    }
    return list;
  }

  /** O candidato já está na lista pela regra do casamento? */
  function hasListItem(values, candidate) {
    if (!Array.isArray(values)) return false;
    const key = normalizeChannelName(candidate);
    if (key === '') return false;
    for (let i = 0; i < values.length; i += 1) {
      if (typeof values[i] === 'string' && normalizeChannelName(values[i]) === key) return true;
    }
    return false;
  }

  function entryHandle(entry) {
    return entry !== null && typeof entry === 'object' ? normalizeHandle(entry.handle) : '';
  }

  function entryName(entry) {
    return entry !== null && typeof entry === 'object' ? normalizeChannelName(entry.name) : '';
  }

  /**
   * Dois registros da allowlist são o mesmo canal? O handle decide quando os
   * dois o têm; senão, o nome normalizado decide.
   */
  function sameChannel(a, b) {
    const handleA = entryHandle(a);
    const handleB = entryHandle(b);
    if (handleA !== '' && handleB !== '') return handleA === handleB;
    const nameA = entryName(a);
    const nameB = entryName(b);
    return nameA !== '' && nameA === nameB;
  }

  /**
   * A allowlist como o armazenamento a guarda: `{name, handle}` aparados,
   * sem entradas vazias e sem canais repetidos.
   */
  function normalizeAllowed(values) {
    if (!Array.isArray(values)) return [];
    const list = [];
    for (let i = 0; i < values.length; i += 1) {
      const entry = values[i];
      if (entry === null || typeof entry !== 'object') continue;
      const name = typeof entry.name === 'string' ? cleanText(entry.name) : '';
      const handle = typeof entry.handle === 'string' ? cleanText(entry.handle) : '';
      if (name === '' && normalizeHandle(handle) === '') continue;
      const clean = { name, handle };
      if (list.some((existing) => sameChannel(existing, clean))) continue;
      list.push(clean);
    }
    return list;
  }

  /** Assinatura estável da allowlist: muda quando o casamento muda. */
  function allowedSignature(values) {
    const list = normalizeAllowed(values);
    const parts = [];
    for (let i = 0; i < list.length; i += 1) {
      parts.push(normalizeHandle(list[i].handle) + '\u0001' + normalizeChannelName(list[i].name));
    }
    return parts.join('\u0002');
  }

  /** O canal está na allowlist pelo handle ou pelo nome exato normalizado? */
  function isAllowedChannel(name, handle, allowedValues) {
    if (!Array.isArray(allowedValues)) return false;
    const normalizedHandle = normalizeHandle(handle);
    const normalizedName = normalizeChannelName(name);
    if (normalizedHandle === '' && normalizedName === '') return false;
    for (let i = 0; i < allowedValues.length; i += 1) {
      const entry = allowedValues[i];
      if (entry === null || typeof entry !== 'object') continue;
      if (normalizedHandle !== '' && normalizeHandle(entry.handle) === normalizedHandle) return true;
      if (normalizedName !== '' && normalizeChannelName(entry.name) === normalizedName) return true;
    }
    return false;
  }

  /** O canal está na blocklist pela mesma regra de sempre (conter o nome). */
  function isBlockedChannel(name, blockedValues) {
    if (keywordCore.matchesChannel(name, blockedValues)) return true;
    if (!Array.isArray(blockedValues)) return false;

    // O casamento do keyword-core só enxerga a-z0-9; para uma entrada de outro
    // alfabeto, compara o texto aparado em minúsculas.
    const haystack = cleanText(name).toLowerCase();
    if (haystack === '') return false;
    for (let i = 0; i < blockedValues.length; i += 1) {
      const entry = blockedValues[i];
      if (typeof entry !== 'string') continue;
      const text = cleanText(entry);
      if (text === '' || keywordCore.normalizeText(text) !== '') continue;
      if (haystack.includes(text.toLowerCase())) return true;
    }
    return false;
  }

  /**
   * A próxima blocklist ao clicar no chip: bloqueia acrescentando o nome, ou
   * desbloqueia removendo as entradas que casam com o canal.
   */
  function nextBlockedChannels(name, blockedValues) {
    const list = normalizeList(blockedValues);
    const channel = cleanText(name);
    if (channel === '') return list;
    if (!isBlockedChannel(channel, list)) return [...list, channel];

    const needle = normalizeChannelName(channel);
    return list.filter((entry) => {
      // A entrada "Rick" casa com o canal "Rick Astley": o nome do canal
      // contém a entrada, e não o contrário.
      const normalized = normalizeChannelName(entry);
      return needle === '' || normalized === '' || !needle.includes(normalized);
    });
  }

  root.YTIChannelRules = {
    MAX_CHANNEL_NAME_LENGTH,
    cleanText,
    normalizeChannelName,
    normalizeHandle,
    handleFromHref,
    isUsableChannelName,
    normalizeList,
    hasListItem,
    sameChannel,
    normalizeAllowed,
    allowedSignature,
    isAllowedChannel,
    isBlockedChannel,
    nextBlockedChannels,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
