/**
 * Teste da colheita sem aba: o HTML da home buscado daqui vira card.
 *
 * O `fetch` e o `chrome` são dublês: testa-se a rota, não o YouTube. O fixture
 * é uma página mínima no formato do HTML real — o `ytInitialData` que o extrator
 * lê e o carimbo de build que o `ytcfg` traria na página.
 */
import { collectFeed, parseBuildLabelFromHtml } from '../src/background/feed-fetch.js';
import { FEED_BUILD_LABEL, FEED_HTML } from './fixtures/feed-page.mjs';

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

/** Dublê mínimo do `chrome`: só as configurações que a colheita lê. */
function fakeChrome() {
  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({
          ...defaults,
          bridgeUrl: 'http://127.0.0.1:8791',
          collectEnabled: true,
          collectPeriodMinutes: 60,
          maxCards: 30,
        }),
      },
      local: {
        get: async (defaults) => ({ ...defaults }),
      },
    },
  };
}

let fetchCalls = [];

/** Troca o `fetch` por um dublê que registra a chamada e responde com `respond`. */
function stubFetch(respond) {
  fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return respond();
  };
}

/** Devolve o erro lançado por `run`, ou `null` se ela passar. */
async function failureOf(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

fakeChrome();

process.stdout.write('busca da home vira cards:\n');
stubFetch(async () => ({ ok: true, status: 200, text: async () => FEED_HTML }));
const harvest = await collectFeed();

check(
  'buscou a home',
  fetchCalls.length === 1 && fetchCalls[0].url === 'https://www.youtube.com/',
  JSON.stringify(fetchCalls.map((call) => call.url)),
);
check('mandou os cookies da sessão', fetchCalls[0].options.credentials === 'include');
check(
  'mandou o idioma do navegador',
  fetchCalls[0].options.headers['accept-language'] === (navigator.language || 'pt-BR'),
  fetchCalls[0].options.headers['accept-language'],
);
check('extraiu um card', harvest.cards.length === 1, `veio ${harvest.cards.length}`);

const card = harvest.cards[0];
check('id do vídeo', card.videoId === 'dSF9MWuB0F0', card.videoId);
check('título', card.title === 'Um vídeo de verdade', card.title);
check('canal', card.channelName === 'Mateus Dias', card.channelName);
check('data', card.publishedText === 'há 2 h', card.publishedText);
check('build label veio do HTML', harvest.buildLabel === FEED_BUILD_LABEL, String(harvest.buildLabel));

process.stdout.write('build label é opcional:\n');
check('HTML sem PAGE_BUILD_LABEL devolve null', parseBuildLabelFromHtml('<html></html>') === null);
check('entrada que não é HTML devolve null', parseBuildLabelFromHtml(null) === null);

process.stdout.write('sem ytInitialData na home:\n');
stubFetch(async () => ({ ok: true, status: 200, text: async () => '<html><body>Faça login</body></html>' }));
const missing = await failureOf(collectFeed);
check('a falha foi declarada', missing instanceof Error, String(missing));
check(
  'o motivo cita o ytInitialData e desconfia do login',
  missing && missing.message.includes('ytInitialData') && missing.message.includes('login'),
  missing && missing.message,
);

process.stdout.write('feed sem card nenhum:\n');
stubFetch(async () => ({
  ok: true,
  status: 200,
  text: async () => '<script>var ytInitialData = {"contents":{}};</script>',
}));
const empty = await failureOf(collectFeed);
check('a falha foi declarada', empty instanceof Error, String(empty));
check('o motivo é lista vazia', empty && empty.message.includes('nenhum card'), empty && empty.message);

process.stdout.write('home responde com erro HTTP:\n');
stubFetch(async () => ({ ok: false, status: 403, text: async () => 'Forbidden' }));
const refused = await failureOf(collectFeed);
check('a falha foi declarada', refused instanceof Error, String(refused));
check('o motivo traz o status', refused && refused.message.includes('HTTP 403'), refused && refused.message);

process.stdout.write('home não responde:\n');
stubFetch(async () => {
  throw new Error('sem rede');
});
const offline = await failureOf(collectFeed);
check('a falha foi declarada', offline instanceof Error, String(offline));
check(
  'o motivo preserva a causa',
  offline && offline.message.includes('busca do feed falhou') && offline.message.includes('sem rede'),
  offline && offline.message,
);

process.stdout.write(failures === 0 ? '\nTUDO OK\n' : `\n${failures} FALHA(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
