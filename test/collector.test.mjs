/**
 * Teste do ciclo da colheita: retentativa e chamadas concorrentes.
 *
 * O `chrome` e o `fetch` são dublês: testa-se a coreografia, não o navegador
 * nem a ponte. A colheita busca a home (o fixture) e entrega por POST; a
 * retentativa é observada pelo alarme que ela agenda — o efeito que o relógio
 * do navegador enxerga —, nunca por dentro do módulo.
 */
import { collectNow } from '../src/background/collector.js';
import { FEED_HTML } from './fixtures/feed-page.mjs';

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

const RETRY_ALARM = 'yti-collect-retry';
const FEED_URL = 'https://www.youtube.com/';

/**
 * Dublê do `chrome` — só o storage e o relógio de alarmes que a colheita usa.
 * Sem `tabs`/`scripting`/`windows`: a rota sem aba não encosta neles.
 */
function fakeChrome() {
  const state = {
    sync: {
      bridgeUrl: 'http://127.0.0.1:8791',
      collectEnabled: true,
      collectPeriodMinutes: 60,
      maxCards: 30,
    },
    local: { bridgeToken: 'token-de-teste' },
    calls: { feed: 0, bridge: [] },
    feedStatus: 200,
    feedGate: null,
    bridgeOk: true,
    alarms: { created: [], cleared: [] },
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
    alarms: {
      create: async (name, info) => {
        state.alarms.created.push({ name, ...info });
      },
      clear: async (name) => {
        state.alarms.cleared.push(name);
        return true;
      },
    },
  };

  globalThis.fetch = async (url, options = {}) => {
    if (url === FEED_URL) {
      state.calls.feed += 1;
      if (state.feedGate) await state.feedGate;
      return {
        ok: state.feedStatus >= 200 && state.feedStatus < 300,
        status: state.feedStatus,
        text: async () => FEED_HTML,
        json: async () => ({}),
      };
    }

    state.calls.bridge.push({ url, ...options });
    return {
      ok: state.bridgeOk,
      status: state.bridgeOk ? 200 : 503,
      json: async () => ({ changed: true }),
      text: async () => 'ponte fora do ar',
    };
  };

  return state;
}

process.stdout.write('colheita que falha agenda retentativa:\n');
{
  const state = fakeChrome();
  state.feedStatus = 503;
  const summary = await collectNow('alarme');

  check('a colheita falhou', summary.ok === false, `ok=${summary.ok}`);
  check('o motivo veio da busca', String(summary.error).includes('HTTP 503'), String(summary.error));
  check(
    'agendou a retentativa de 5 minutos',
    state.alarms.created.some((alarm) => alarm.name === RETRY_ALARM && alarm.delayInMinutes === 5),
    JSON.stringify(state.alarms.created),
  );
  check('nada foi entregue', state.calls.bridge.length === 0, `entregou ${state.calls.bridge.length}`);
}

process.stdout.write('retentativa tem teto:\n');
{
  const state = fakeChrome();
  state.feedStatus = 503;
  await collectNow('alarme');
  await collectNow('retentativa');
  await collectNow('retentativa');
  const scheduled = state.alarms.created.filter((alarm) => alarm.name === RETRY_ALARM);
  check('duas retentativas agendadas; a terceira não', scheduled.length === 2, `agendou ${scheduled.length}`);
}

process.stdout.write('sucesso encerra o episódio de retentativa:\n');
{
  const state = fakeChrome();
  state.feedStatus = 503;
  await collectNow('alarme');
  state.feedStatus = 200;
  const summary = await collectNow('alarme');

  check('a segunda colheita foi entregue', summary.ok === true && summary.cardCount === 1);
  check('limpou a retentativa pendente', state.alarms.cleared.includes(RETRY_ALARM));
  check(
    'o resumo não carrega campos de aba',
    !('reusedTab' in summary) &&
      !('tabClosed' in summary) &&
      !('focus' in summary) &&
      !('maximized' in summary) &&
      !('maximizeReason' in summary),
    JSON.stringify(Object.keys(summary)),
  );
}

process.stdout.write('ponte fora do ar é rodada falha:\n');
{
  const state = fakeChrome();
  state.bridgeOk = false;
  const summary = await collectNow('alarme');

  check('a rodada falhou', summary.ok === false, `ok=${summary.ok}`);
  check('o card foi colhido mesmo assim', summary.cardCount === 1, `cardCount=${summary.cardCount}`);
  check(
    'o lote ficou na fila',
    Array.isArray(state.local.pendingHarvests) && state.local.pendingHarvests.length === 1,
    JSON.stringify(state.local.pendingHarvests ? state.local.pendingHarvests.length : null),
  );
  check(
    'agendou a retentativa',
    state.alarms.created.some((alarm) => alarm.name === RETRY_ALARM),
    JSON.stringify(state.alarms.created),
  );
}

process.stdout.write('chamadas concorrentes colhem uma vez só:\n');
{
  const state = fakeChrome();
  let release = null;
  state.feedGate = new Promise((resolve) => {
    release = resolve;
  });

  const first = collectNow('alarme');
  const second = collectNow('manual');
  release();
  const [a, b] = await Promise.all([first, second]);

  check('buscou o feed uma vez só', state.calls.feed === 1, `buscou ${state.calls.feed}`);
  check('entregou uma vez só', state.calls.bridge.length === 1, `entregou ${state.calls.bridge.length}`);
  check('as duas chamadas viram o mesmo resultado', a === b);
}

process.stdout.write(failures === 0 ? '\nTUDO OK\n' : `\n${failures} FALHA(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
