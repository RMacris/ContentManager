/**
 * Teste do cliente da ponte: teto da fila, ordem e parada da entrega, prazo das
 * chamadas e classificação do que deu errado.
 *
 * O `chrome` e o `fetch` são dublês: testa-se o contrato do cliente, não o
 * navegador nem a ponte.
 */
import {
  flushQueue,
  pingBridge,
  queueHarvest,
  sendHarvest,
  sendSubscriptions,
} from '../src/background/bridge-client.js';

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

/** Dublê do `chrome.storage` — só o que o cliente da ponte lê e grava. */
function fakeChrome({ bridgeToken = 'token-de-teste', bridgeUrl = 'http://127.0.0.1:8791' } = {}) {
  const state = {
    sync: { bridgeUrl },
    local: bridgeToken === '' ? {} : { bridgeToken },
  };

  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...state.sync }),
      },
      local: {
        get: async (defaults) => {
          const out = {};
          for (const key of Object.keys(defaults)) {
            out[key] = key in state.local ? state.local[key] : defaults[key];
          }
          return out;
        },
        set: async (items) => {
          Object.assign(state.local, items);
        },
        remove: async (key) => {
          delete state.local[key];
        },
      },
    },
  };

  return state;
}

/** Uma resposta HTTP de mentira, com o que o cliente realmente usa. */
function response({ status = 200, body = {}, text = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text,
  };
}

/** Instala um `fetch` dublê e devolve os pedidos, na ordem em que saíram. */
function recordFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  return calls;
}

process.stdout.write('a fila respeita o teto e descarta o lote mais velho:\n');
{
  const state = fakeChrome();
  for (let index = 1; index <= 7; index += 1) {
    await queueHarvest({ collectedAt: `2026-10-20T0${index}:00:00Z` });
  }

  const queue = state.local.pendingHarvests;
  check('guardou cinco lotes', queue.length === 5, `guardou ${queue.length}`);
  check(
    'o lote mais velho saiu; o terceiro é o primeiro',
    queue[0].collectedAt === '2026-10-20T03:00:00Z',
    queue[0].collectedAt,
  );
}

process.stdout.write('a fila entrega em ordem e para na primeira falha:\n');
{
  const state = fakeChrome();
  for (const collectedAt of ['a', 'b', 'c', 'd']) await queueHarvest({ collectedAt });

  const calls = recordFetch((_url, _options, order) => {
    if (order <= 2) return response({ status: 200, body: { changed: true } });
    return response({ status: 400, text: 'lote inválido' });
  });

  const result = await flushQueue();
  check('entregou os dois primeiros', result.delivered === 2 && result.remaining === 2, JSON.stringify(result));
  check('parou na primeira falha', calls.length === 3, `fez ${calls.length} pedidos`);
  check(
    'a ordem das entregas foi a da fila',
    calls.map((call) => JSON.parse(call.options.body).collectedAt).join(',') === 'a,b,c',
  );
  check(
    'o último resultado veio classificado',
    result.delivery.ok === false && result.delivery.kind === 'rejected',
    JSON.stringify(result.delivery),
  );
  check(
    'a fila guardou os lotes que não saíram',
    state.local.pendingHarvests.map((item) => item.collectedAt).join(',') === 'c,d',
  );
}

process.stdout.write('a chamada tem prazo e é abortada:\n');
{
  fakeChrome();
  let aborted = false;
  const calls = recordFetch(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('abortado'));
        });
      }),
  );

  const result = await sendHarvest({ collectedAt: 'agora' }, { timeoutMs: 10 });
  check('classificou como timeout', result.ok === false && result.kind === 'timeout', JSON.stringify(result));
  check('a requisição foi abortada', aborted && calls[0].options.signal.aborted === true);
  check('a frase fala do prazo', /não respondeu em 10 ms/.test(result.detail), result.detail);
}

process.stdout.write('401, 400 e rede fora têm classificações próprias:\n');
{
  fakeChrome();

  recordFetch(() => response({ status: 401, text: 'token inválido' }));
  const unauthorized = await sendHarvest({ collectedAt: 'agora' });
  check(
    '401 vira token recusado',
    unauthorized.ok === false &&
      unauthorized.kind === 'unauthorized' &&
      unauthorized.detail === 'token recusado pela ponte',
    JSON.stringify(unauthorized),
  );

  recordFetch(() => response({ status: 400, text: 'cards ausente' }));
  const rejected = await sendHarvest({ collectedAt: 'agora' });
  check(
    '400 vira recusa com o trecho do corpo',
    rejected.ok === false &&
      rejected.kind === 'rejected' &&
      rejected.detail.startsWith('a ponte recusou (HTTP 400): cards ausente'),
    rejected.detail,
  );

  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const offline = await sendHarvest({ collectedAt: 'agora' });
  check(
    'rede fora vira sem conexão',
    offline.ok === false && offline.kind === 'offline' && offline.detail === 'sem conexão com a ponte',
    JSON.stringify(offline),
  );
  check('nenhum detalhe cru de fetch vaza', !offline.detail.includes('Failed to fetch'));
}

process.stdout.write('sem token não tenta a rede:\n');
{
  fakeChrome({ bridgeToken: '' });
  const calls = recordFetch(() => response({ status: 200 }));
  const result = await sendHarvest({ collectedAt: 'agora' });
  check(
    'classificou o token ausente',
    result.ok === false && result.kind === 'missing-token' && result.detail === 'token não configurado no popup',
    JSON.stringify(result),
  );
  check('não chamou a ponte', calls.length === 0, `fez ${calls.length} pedidos`);
}

process.stdout.write('as inscrições usam o mesmo contrato:\n');
{
  fakeChrome();
  const calls = recordFetch(() => response({ status: 200, body: { stored: 3 } }));
  const result = await sendSubscriptions({ channels: [] }, { timeoutMs: 10 });
  check(
    'entregou e trouxe o corpo',
    result.ok === true && result.kind === 'ok' && result.body.stored === 3,
    JSON.stringify(result),
  );
  check('bateu no /subscriptions', calls[0].url.endsWith('/subscriptions'), calls[0].url);
}

process.stdout.write('ping da ponte:\n');
{
  fakeChrome();
  const calls = recordFetch(() => response({ status: 200, body: { ok: true } }));
  const healthy = await pingBridge();
  check('respondeu', healthy.ok === true && healthy.kind === 'ok', JSON.stringify(healthy));
  check(
    'bateu no /health com GET',
    calls[0].url.endsWith('/health') && calls[0].options.method === 'GET',
    calls[0].url,
  );

  recordFetch(() => response({ status: 500, text: 'erro interno' }));
  const refused = await pingBridge();
  check(
    'classificou a recusa',
    refused.ok === false && refused.kind === 'rejected',
    JSON.stringify(refused),
  );

  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const offline = await pingBridge();
  check(
    'classificou a rede fora',
    offline.ok === false && offline.kind === 'offline',
    JSON.stringify(offline),
  );
}

process.stdout.write(failures === 0 ? '\nTUDO OK\n' : `\n${failures} FALHA(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
