/**
 * Idade de publicação de um card do YouTube, em segundos.
 *
 * Script clássico de propósito: o Chrome carrega este arquivo e o
 * `age-filter.js` na mesma execução do content script, sem `import`/`export` —
 * o filtro lê a API daqui pelo global. O arquivo é puro (sem DOM e sem
 * `chrome`) para a suíte rodá-lo no Node.
 *
 * A idade vem do texto que o próprio YouTube escreve no card ("há 5 h",
 * "1 day ago"). Não existe timestamp absoluto no card, então a leitura é
 * aproximada de propósito — a mesma que o usuário vê.
 *
 * O limite não mora aqui: quem chama passa as horas que vieram do
 * `settings-contract.js` (dono do padrão e da faixa).
 */
(function (root) {
  'use strict';

  const HOUR_SECONDS = 3600;
  const DAY_SECONDS = HOUR_SECONDS * 24;

  /** Fatores em segundos: as formas que o card mostra em pt e en. */
  const UNIT_SECONDS = {
    seg: 1,
    segs: 1,
    segundo: 1,
    segundos: 1,
    second: 1,
    seconds: 1,
    min: 60,
    mins: 60,
    minuto: 60,
    minutos: 60,
    minute: 60,
    minutes: 60,
    h: HOUR_SECONDS,
    hs: HOUR_SECONDS,
    hora: HOUR_SECONDS,
    horas: HOUR_SECONDS,
    hour: HOUR_SECONDS,
    hours: HOUR_SECONDS,
    hr: HOUR_SECONDS,
    hrs: HOUR_SECONDS,
    dia: DAY_SECONDS,
    dias: DAY_SECONDS,
    day: DAY_SECONDS,
    days: DAY_SECONDS,
    sem: 604800,
    sems: 604800,
    semana: 604800,
    semanas: 604800,
    week: 604800,
    weeks: 604800,
    wk: 604800,
    wks: 604800,
    mes: 2592000,
    meses: 2592000,
    month: 2592000,
    months: 2592000,
    mo: 2592000,
    mos: 2592000,
    ano: 31536000,
    anos: 31536000,
    year: 31536000,
    years: 31536000,
    yr: 31536000,
    yrs: 31536000,
  };

  const NUMBER_WORDS = {
    um: 1,
    uma: 1,
    one: 1,
    a: 1,
    an: 1,
  };

  /**
   * Textos que são uma ação do usuário, não a publicação do vídeo.
   *
   * É o que aparece no histórico ("Assistido há 2 dias") e nas listas salvas.
   * Sem esta guarda, o filtro esconderia o que o usuário fez — nesses casos a
   * data não é uma recomendação.
   */
  const ACTION_WORDS = new Set([
    'watched',
    'viewed',
    'assistido',
    'assistida',
    'assistiu',
    'visto',
    'viu',
    'liked',
    'curtido',
    'curtida',
    'curtiu',
    'added',
    'adicionado',
    'adicionada',
    'adicionou',
    'saved',
    'salvo',
    'salva',
    'salvou',
    'updated',
    'atualizado',
    'atualizada',
  ]);

  /**
   * A idade em segundos; `null` quando o texto não é uma data reconhecida, é
   * uma ação do usuário ou não tem forma de idade relativa.
   */
  function parseAge(text) {
    if (typeof text !== 'string') return null;

    const normalized = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.,;:]+$/, '');

    if (normalized === '') return null;

    const words = normalized.split(' ');
    for (let i = 0; i < words.length; i += 1) {
      if (ACTION_WORDS.has(words[i])) return null;
    }

    const amount = (raw) => {
      if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, raw)) {
        return NUMBER_WORDS[raw];
      }
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };

    const seconds = (value, unit) => {
      const factor = UNIT_SECONDS[unit];
      return factor === undefined ? null : value * factor;
    };

    // "há 3 h", "há 2 dias", "há um mês"
    const pt = normalized.match(/(?:^|\s)ha\s+(\d+|um|uma)\s*([a-z]+)/);
    if (pt !== null) {
      const value = amount(pt[1]);
      const age = value === null ? null : seconds(value, pt[2]);
      if (age !== null) return age;
    }

    // "3 hours ago", "streamed 2 days ago"
    const en = normalized.match(/(\d+|um|uma|one|a|an)\s+([a-z]+)s?\s+ago\b/);
    if (en !== null) {
      const value = amount(en[1]);
      const age = value === null ? null : seconds(value, en[2]);
      if (age !== null) return age;
    }

    // "1 dia atrás", "2 semanas atrás"
    const ptSuffix = normalized.match(/(\d+|um|uma|one|a|an)\s+([a-z]+)s?\s+atras\b/);
    if (ptSuffix !== null) {
      const value = amount(ptSuffix[1]);
      const age = value === null ? null : seconds(value, ptSuffix[2]);
      if (age !== null) return age;
    }

    return null;
  }

  /**
   * A data é mais velha que `maxHours` horas? A comparação é estrita: o card
   * de "6 horas" fica com limite de 6 horas, o de "7 horas" some — é o "mais
   * de 6 horas" que o usuário pediu.
   *
   * O limite é sempre explícito: o dono do padrão e da faixa é o
   * `settings-contract.js`, não este módulo. Um limite ausente ou inválido não
   * esconde nada, em vez de criar uma terceira cópia da política.
   */
  function shouldHideAge(seconds, maxHours) {
    return (
      typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      typeof maxHours === 'number' &&
      Number.isFinite(maxHours) &&
      maxHours > 0 &&
      seconds > maxHours * HOUR_SECONDS
    );
  }

  /** Atalho: o texto do card descreve uma publicação mais velha que o limite? */
  function shouldHide(text, maxHours) {
    return shouldHideAge(parseAge(text), maxHours);
  }

  root.YTIAgeFilter = {
    HOUR_SECONDS,
    DAY_SECONDS,
    ACTION_WORDS,
    UNIT_SECONDS,
    parseAge,
    shouldHideAge,
    shouldHide,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
