/**
 * Teste da extração das inscrições do YouTube.
 *
 * O payload de referência é a forma real do `channelRenderer` (medida em um
 * resultado de busca por canal, 11/10/2026): `channelId`, `title`, o handle em
 * `navigationEndpoint.browseEndpoint.canonicalBaseUrl` e a contagem de inscritos
 * em `videoCountText` — com `subscriberCountText` carregando o próprio `@handle`.
 * É a mesma forma que a grade da página de inscrições usa.
 *
 * A extração segue as continuações da lista (`/youtubei/v1/browse`, forma
 * medida no mesmo dia); aqui `fetch` e `ytcfg` são dublês, para a suíte exercitar
 * a paginação inteira sem rede.
 *
 * O `chrome` não entra aqui: a função é pura sobre o JSON, como o `feed-extract`.
 */
import { extractSubscriptions } from '../src/injected/subscriptions-extract.js';

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

/** O nó de continuação como o YouTube o entregou (medido 11/10/2026). */
function continuationNode(token, request = 'CONTINUATION_REQUEST_TYPE_BROWSE') {
  return {
    trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
    continuationEndpoint: {
      clickTrackingParams: 'CBQQ6TgYACITCPv0kZqIsZcDFQIG7AodR3wBbQ==',
      continuationCommand: { token, request },
    },
  };
}

/** Uma resposta de continuação: o append com os itens e, opcionalmente, o próximo token. */
function continuationResponse(items, { next = null, request = 'CONTINUATION_REQUEST_TYPE_BROWSE' } = {}) {
  const continuationItems = items.slice();
  if (next !== null) continuationItems.push({ continuationItemRenderer: continuationNode(next, request) });
  return { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems } }] };
}

/** Um `ytcfg` dublê com o essencial da paginação. */
const YT_CFG = {
  INNERTUBE_API_KEY: 'CHAVE_DE_TESTE_NAO_E_SEGREDO',
  INNERTUBE_CONTEXT: {
    client: { clientName: 'WEB', clientVersion: '2.20261009.01.00', visitorData: 'visitante-de-teste' },
  },
};
function fakeYtCfg() {
  return { get: (key) => YT_CFG[key] ?? null };
}

/** Um `fetch` dublê: responde por `continuation` ou `browseId`, e registra as chamadas. */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), method: options.method, headers: options.headers, body });
    const key = body.continuation ?? body.browseId ?? '(sem chave)';
    const response = responses[key];
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error(`sem resposta para ${key}`);
    if (response.ok === false) return response; // resposta HTTP que não deu certo (ex.: 400 do token final)
    return { ok: true, status: 200, json: async () => response };
  };
  impl.calls = calls;
  return impl;
}

/** Um `channelRenderer` como o YouTube o entrega hoje. */
function channelRenderer({ id, title, handle = null, subscribers = '', avatar = 'avatar' }) {
  const url = handle === null ? `/channel/${id}` : `/@${handle}`;
  return {
    channelId: id,
    title: { simpleText: title },
    navigationEndpoint: {
      clickTrackingParams: 'CGUQ2jAYACITCKKS56KSsZcDFVphSAAdhnE8lMoBBMEpZ9s=',
      commandMetadata: {
        webCommandMetadata: {
          url,
          webPageType: 'WEB_PAGE_TYPE_CHANNEL',
          rootVe: 3611,
          apiUrl: '/youtubei/v1/browse',
        },
      },
      browseEndpoint: { browseId: id, canonicalBaseUrl: url },
    },
    thumbnail: {
      thumbnails: [
        { url: `//yt3.ggpht.com/${avatar}=s88-c-k-c0x00ffffff-no-rj-mo`, width: 88, height: 88 },
        { url: `//yt3.ggpht.com/${avatar}=s176-c-k-c0x00ffffff-no-rj-mo`, width: 176, height: 176 },
      ],
    },
    descriptionSnippet: { runs: [{ text: 'Linha de descrição do canal…' }] },
    shortBylineText: { runs: [{ text: title }] },
    videoCountText: { simpleText: subscribers },
    subscriptionButton: { subscribed: true },
    subscriberCountText: { simpleText: handle === null ? '' : `@${handle}` },
  };
}

/** A grade como a página de inscrições a embute: sectionList → gridRenderer. */
function pageWith(
  items,
  { continuation = false, token = 'CONTINUATION_TOKEN_DE_EXEMPLO', request = 'CONTINUATION_REQUEST_TYPE_BROWSE' } = {},
) {
  const contents = [{ gridRenderer: { items } }];
  if (continuation) {
    contents.push({ continuationItemRenderer: continuationNode(token, request) });
  }
  return {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: {
                sectionListRenderer: {
                  contents: [{ itemSectionRenderer: { contents } }],
                },
              },
            },
          },
        ],
      },
    },
  };
}

const FIRESHIP = {
  id: 'UCsBjURrPoezykLs9EqgamOA',
  title: 'Fireship',
  handle: 'Fireship',
  subscribers: '4,29 mi de inscritos',
  avatar: '3fPNbkf_xPyCleq77ZhcxyeorY97NtMHVNUbaAON_RBDH9ydL4hJkjxC8x_4mpuopkB8oI7Ct6Y',
};
const OUTRA = {
  id: 'UCaO6VoaYJv4kS-TQO_M-N_g',
  title: 'Dev em Dobro',
  handle: 'devemdobro',
  subscribers: '1,02 mi de inscritos',
  avatar: 'outroCanal',
};
const TERCEIRA = {
  id: 'UCrWvhVmt0Qac3HgsjQK62FQ',
  title: 'Curso em Vídeo',
  handle: 'cursoemvideo',
  subscribers: '3,44 mi de inscritos',
  avatar: 'cursoEmVideo',
};

process.stdout.write('extração das inscrições da página:\n');
{
  const data = pageWith([
    { channelRenderer: channelRenderer(FIRESHIP) },
    { channelRenderer: channelRenderer(OUTRA) },
  ]);
  const result = await extractSubscriptions(1000, data);

  check('a extração deu certo', result.ok === true, result.reason ?? '');
  check('achou os dois canais', result.channels.length === 2, String(result.channels.length));

  const fire = result.channels[0];
  check('trouxe o id do canal', fire.channelId === FIRESHIP.id, fire.channelId);
  check('trouxe o título', fire.title === 'Fireship', fire.title);
  check('trouxe o handle', fire.handle === 'Fireship', String(fire.handle));
  check(
    'trouxe o avatar em https',
    fire.avatarUrl === `https://yt3.ggpht.com/${FIRESHIP.avatar}=s176-c-k-c0x00ffffff-no-rj-mo`,
    String(fire.avatarUrl),
  );
  check('trouxe a contagem de inscritos', fire.subscribersText === '4,29 mi de inscritos', String(fire.subscribersText));
  check('a página não indicou continuação', result.hasMore === false);
  check('e nada foi paginado', result.pages === 0 && result.stopReason === 'no-continuation', `${result.pages}/${result.stopReason}`);
}

process.stdout.write('formas alternativas do handle e do contador:\n');
{
  // Sem `canonicalBaseUrl`: o handle só existe na URL do comando.
  const withoutCanonical = channelRenderer({ ...OUTRA, handle: null });
  delete withoutCanonical.navigationEndpoint.browseEndpoint.canonicalBaseUrl;
  withoutCanonical.navigationEndpoint.commandMetadata.webCommandMetadata.url = '/@devemdobro';
  withoutCanonical.subscriberCountText = { simpleText: '' };

  // Sem nenhuma URL de canal: o `subscriberCountText` carrega o `@handle`.
  const byText = channelRenderer({ ...FIRESHIP, handle: null });
  byText.navigationEndpoint.browseEndpoint.canonicalBaseUrl = `/channel/${FIRESHIP.id}`;
  byText.navigationEndpoint.commandMetadata.webCommandMetadata.url = `/channel/${FIRESHIP.id}`;
  byText.subscriberCountText = { simpleText: '@Fireship' };

  const result = await extractSubscriptions(1000, pageWith([{ channelRenderer: withoutCanonical }, { channelRenderer: byText }]));

  check('handle lido da URL do comando', result.channels[0].handle === 'devemdobro', String(result.channels[0].handle));
  check('handle lido do subscriberCountText', result.channels[1].handle === 'Fireship', String(result.channels[1].handle));
}

process.stdout.write('canal sem handle continua na lista:\n');
{
  const semHandle = channelRenderer({ ...OUTRA, handle: null });
  const result = await extractSubscriptions(1000, pageWith([{ channelRenderer: semHandle }]));

  check('o canal foi mantido', result.channels.length === 1);
  check('o handle é nulo, não string vazia', result.channels[0].handle === null, String(result.channels[0].handle));
  check('o título continua', result.channels[0].title === 'Dev em Dobro');
}

process.stdout.write('o mesmo canal duas vezes não duplica:\n');
{
  const data = pageWith([
    { channelRenderer: channelRenderer(FIRESHIP) },
    { channelRenderer: channelRenderer({ ...FIRESHIP, title: 'Fireship (sugestão)' }) },
  ]);
  const result = await extractSubscriptions(1000, data);

  check('deduplicou pelo id', result.channels.length === 1, String(result.channels.length));
}

process.stdout.write('ruído da página não vira canal:\n');
{
  const data = pageWith([
    {
      chipCloudRenderer: {
        chips: [
          { chipCloudChipRenderer: { text: { simpleText: 'Tudo' } } },
          { chipCloudChipRenderer: { text: { simpleText: 'Assistidos' } } },
        ],
      },
    },
    {
      // Um vídeo de um canal: tem o canal no byline, mas não é uma inscrição.
      videoRenderer: {
        videoId: 'dQw4w9WgXcQ',
        title: { runs: [{ text: 'Vídeo qualquer' }] },
        ownerText: {
          runs: [
            {
              text: 'Fireship',
              navigationEndpoint: {
                browseEndpoint: { browseId: FIRESHIP.id, canonicalBaseUrl: '/@Fireship' },
              },
            },
          ],
        },
      },
    },
    { channelRenderer: channelRenderer(FIRESHIP) },
  ]);
  const result = await extractSubscriptions(1000, data);

  check('só a inscrição entrou', result.channels.length === 1, String(result.channels.length));
  check('e é o canal certo', result.channels[0].channelId === FIRESHIP.id);
}

process.stdout.write('teto e indicação de continuação:\n');
{
  const data = pageWith(
    [{ channelRenderer: channelRenderer(FIRESHIP) }, { channelRenderer: channelRenderer(OUTRA) }],
    { continuation: true },
  );
  const fetchImpl = fakeFetch({});
  const result = await extractSubscriptions(1, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('respeitou o teto', result.channels.length === 1, String(result.channels.length));
  check('a página indicou que há mais', result.hasMore === true);
  check('o corte foi declarado como teto', result.stopReason === 'cap', String(result.stopReason));
  check('não gastou pedido para além do teto', result.pages === 0 && fetchImpl.calls.length === 0);
}

process.stdout.write('a continuação é seguida até o fim:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }], { continuation: true, token: 'TOKEN_PAGINA_1' });
  const fetchImpl = fakeFetch({
    TOKEN_PAGINA_1: continuationResponse([{ channelRenderer: channelRenderer(OUTRA) }], { next: 'TOKEN_PAGINA_2' }),
    TOKEN_PAGINA_2: continuationResponse([{ channelRenderer: channelRenderer(TERCEIRA) }]),
  });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('trouxe a lista inteira', result.channels.length === 3, String(result.channels.length));
  check(
    'na ordem da página',
    result.channels.map((channel) => channel.title).join('|') === 'Fireship|Dev em Dobro|Curso em Vídeo',
    result.channels.map((channel) => channel.title).join('|'),
  );
  check('paginou duas vezes', result.pages === 2, String(result.pages));
  check('declarou que terminou', result.stopReason === 'complete', String(result.stopReason));
  check('sem aviso de parcial', result.hasMore === false);
  check(
    'foi pelo endpoint de browse',
    fetchImpl.calls.length === 2 && fetchImpl.calls.every((call) => call.url.includes('/youtubei/v1/browse')),
    JSON.stringify(fetchImpl.calls.map((call) => call.url)),
  );
  check('mandou o primeiro token', fetchImpl.calls[0].body.continuation === 'TOKEN_PAGINA_1');
  check('mandou o segundo token', fetchImpl.calls[1].body.continuation === 'TOKEN_PAGINA_2');
}

process.stdout.write('token de outra seção não é seguido:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }], { continuation: true, token: 'TOKEN_DA_GRADE' });
  // Um token de guia **antes** da grade, na ordem do documento: sem o escopo
  // por ancestral, ele seria o primeiro da fila.
  const withGuide = {
    guide: {
      entries: [{ guideEntryRenderer: { title: 'Inscrições' } }, { continuationItemRenderer: continuationNode('TOKEN_DO_GUIA') }],
    },
    ...data,
  };
  const fetchImpl = fakeFetch({ TOKEN_DA_GRADE: continuationResponse([{ channelRenderer: channelRenderer(OUTRA) }]) });
  const result = await extractSubscriptions(1000, withGuide, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check(
    'seguiu a continuação da grade',
    fetchImpl.calls.length === 1 && fetchImpl.calls[0].body.continuation === 'TOKEN_DA_GRADE',
    JSON.stringify(fetchImpl.calls.map((call) => call.body.continuation)),
  );
  check('o token do guia ficou de fora', !fetchImpl.calls.some((call) => call.body.continuation === 'TOKEN_DO_GUIA'));
  check('achou os dois canais', result.channels.length === 2, String(result.channels.length));
}

process.stdout.write('nó de continuação com nome novo ainda é seguido:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }]);
  // Migração para view models: o token ficou fundo no nó, longe da forma clássica.
  data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents.push({
    continuationItemViewModel: {
      button: { innertubeCommand: { continuationCommand: { token: 'TOKEN_VIEW_MODEL_PARA_TESTE_1234' } } },
    },
  });
  const fetchImpl = fakeFetch({
    TOKEN_VIEW_MODEL_PARA_TESTE_1234: continuationResponse([{ channelRenderer: channelRenderer(OUTRA) }]),
  });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check(
    'a forma renomeada foi seguida',
    fetchImpl.calls.length === 1 && fetchImpl.calls[0].body.continuation === 'TOKEN_VIEW_MODEL_PARA_TESTE_1234',
    JSON.stringify(fetchImpl.calls.map((call) => call.body.continuation)),
  );
  check('agregou a página', result.channels.length === 2, String(result.channels.length));
}

process.stdout.write('falha de rede declara parcial e mantém o que veio:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }], { continuation: true, token: 'TOKEN_PAGINA_1' });
  const fetchImpl = fakeFetch({ TOKEN_PAGINA_1: new Error('sem rede') });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('manteve o que veio', result.channels.length === 1, String(result.channels.length));
  check('declarou parcial', result.hasMore === true && result.stopReason === 'fetch-failed', String(result.stopReason));
  check('tentou uma vez', result.pages === 1, String(result.pages));
}

process.stdout.write('o token final recusado pelo YouTube fecha a lista:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }], { continuation: true, token: 'TOKEN_FINAL' });
  const fetchImpl = fakeFetch({ TOKEN_FINAL: { ok: false, status: 400 } });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('manteve o que veio', result.channels.length === 1, String(result.channels.length));
  check('400 do token final é fim, não parcial', result.hasMore === false && result.stopReason === 'complete', String(result.stopReason));
  check('não repetiu o pedido', result.pages === 1 && fetchImpl.calls.length === 1, String(result.pages));
}

process.stdout.write('sem continuação no retrato, o browseId confirma o fim:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }]);
  const fetchImpl = fakeFetch({
    FEchannels: pageWith(
      [{ channelRenderer: channelRenderer(FIRESHIP) }, { channelRenderer: channelRenderer(OUTRA) }],
      { continuation: true, token: 'TOKEN_PAGINA_1' },
    ),
    TOKEN_PAGINA_1: continuationResponse([{ channelRenderer: channelRenderer(TERCEIRA) }]),
  });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('perguntou pelo browseId da página', fetchImpl.calls[0].body.browseId === 'FEchannels', String(fetchImpl.calls[0].body.browseId));
  check('agregou o que faltava', result.channels.length === 3, String(result.channels.length));
  check(
    'não duplicou o repetido',
    result.channels.filter((channel) => channel.channelId === FIRESHIP.id).length === 1,
    String(result.channels.length),
  );
  check('paginou até o fim', result.pages === 2 && result.stopReason === 'complete', `${result.pages}/${result.stopReason}`);
}

process.stdout.write('o fecho pelo browseId precisa reconhecer a grade:\n');
{
  // O retrato não traz continuação; o fecho pergunta a grade pelo browseId. Se a
  // resposta não tem NEM canal NEM token, não podemos jurar que a lista acabou —
  // é a página em uma forma que o leitor não conhece, não o fim.
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }]);
  const fetchImpl = fakeFetch({ FEchannels: { responseContext: {}, trackingParams: 'x' } });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('resposta vazia não jura fim', result.hasMore === true, String(result.hasMore));
  check('declara a forma não reconhecida', result.stopReason === 'bootstrap-unrecognized', String(result.stopReason));
  check('ficou com o canal do retrato', result.channels.length === 1, String(result.channels.length));
}

process.stdout.write('o fecho que falha também não jura fim:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }]);
  const fetchImpl = fakeFetch({ FEchannels: new Error('sem rede') });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('falha do fecho declara parcial', result.hasMore === true && result.stopReason === 'bootstrap-failed', String(result.stopReason));
  check('ficou com o canal do retrato', result.channels.length === 1, String(result.channels.length));
}

process.stdout.write('o diagnóstico denuncia a forma da página:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }], { continuation: true, token: 'TOKEN_PAGINA_1' });
  const fetchImpl = fakeFetch({ TOKEN_PAGINA_1: continuationResponse([{ channelRenderer: channelRenderer(OUTRA) }]) });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });
  const snapshot = result.diagnostics && result.diagnostics.snapshot;

  check('diagnóstico do retrato presente', snapshot !== null && snapshot !== undefined, JSON.stringify(result.diagnostics ?? null).slice(0, 80));
  check(
    'diz onde mora o primeiro canal',
    snapshot !== undefined && String(snapshot.firstChannelPath).includes('gridRenderer.items'),
    snapshot ? String(snapshot.firstChannelPath) : '—',
  );
  check(
    'lista a chave de continuação vista',
    snapshot !== undefined && snapshot.continuationKeys.some((entry) => entry.k === 'continuationItemRenderer'),
    snapshot ? JSON.stringify(snapshot.continuationKeys.map((entry) => entry.k)) : '—',
  );
  check('conta os canais vistos no retrato', snapshot !== undefined && snapshot.channelsSeen === 1, snapshot ? String(snapshot.channelsSeen) : '—');
  check(
    'o diagnóstico de cada página também vem',
    result.diagnostics.pages.length === 1 && result.diagnostics.pages[0].channelsSeen === 1,
    JSON.stringify(result.diagnostics.pages.map((p) => p.channelsSeen)),
  );
}

process.stdout.write('o diagnóstico enxerga chaves com nome novo:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }]);
  // A paginação mudou de nome: o diagnóstico tem de mostrar a chave mesmo sem o
  // leitor reconhecê-la — é assim que a forma nova chega até quem conserta.
  data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents.push({
    pagination: { nextPageToken: 'TOKEN_QUE_NAO_SE_PARECE_COM_CONTINUACAO_CLASSICA_123456' },
  });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fakeFetch({}) });
  const snapshot = result.diagnostics.snapshot;

  check(
    'a chave nova aparece no censo de tokens',
    snapshot.tokenKeys.some((entry) => entry.k === 'nextPageToken'),
    JSON.stringify(snapshot.tokenKeys.map((entry) => entry.k)),
  );
  check(
    'e o caminho dela vai junto',
    snapshot.tokenKeys.some((entry) => entry.p.includes('pagination.nextPageToken')),
    JSON.stringify(snapshot.tokenKeys.map((entry) => entry.p)),
  );
}

process.stdout.write('uma continuação que vem vazia de cara não jura fim:\n');
{
  // O token do retrato devolve append sem itens e sem próximo token. Se a
  // primeira página da corrente já vem vazia, nada prova o mecanismo — pode ser
  // token podre, não fim de lista.
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }], { continuation: true, token: 'TOKEN_PAGINA_1' });
  const fetchImpl = fakeFetch({ TOKEN_PAGINA_1: continuationResponse([]) });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('primeira página vazia declara parcial', result.hasMore === true, String(result.hasMore));
  check('e nomeia a corrente morta', result.stopReason === 'stale-continuation', String(result.stopReason));
  check('ficou com o canal do retrato', result.channels.length === 1, String(result.channels.length));
}

process.stdout.write('a busca usa o endpoint de busca:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }], {
    continuation: true,
    token: 'TOKEN_DE_BUSCA',
    request: 'CONTINUATION_REQUEST_TYPE_SEARCH',
  });
  const fetchImpl = fakeFetch({
    TOKEN_DE_BUSCA: continuationResponse([{ channelRenderer: channelRenderer(OUTRA) }]),
  });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('o pedido foi ao endpoint de busca', fetchImpl.calls[0].url.includes('/youtubei/v1/search'), fetchImpl.calls[0].url);
  check(
    'levou a chave e o cliente no cabeçalho',
    fetchImpl.calls[0].url.includes('CHAVE_DE_TESTE') && fetchImpl.calls[0].headers['x-youtube-client-name'] === '1',
    fetchImpl.calls[0].url,
  );
  check('coletou a segunda página', result.channels.length === 2, String(result.channels.length));
}

process.stdout.write('o mesmo token em ciclo para:\n');
{
  const data = pageWith([{ channelRenderer: channelRenderer(FIRESHIP) }], { continuation: true, token: 'TOKEN_PAGINA_1' });
  const fetchImpl = fakeFetch({
    TOKEN_PAGINA_1: continuationResponse([{ channelRenderer: channelRenderer(OUTRA) }], { next: 'TOKEN_PAGINA_1' }),
  });
  const result = await extractSubscriptions(1000, data, { ytcfg: fakeYtCfg(), fetch: fetchImpl });

  check('não girou em círculo', result.pages === 1, String(result.pages));
  check('parou declarando o ciclo', result.stopReason === 'loop' && result.hasMore === true, String(result.stopReason));
  check('ficou com os dois canais', result.channels.length === 2, String(result.channels.length));
}

process.stdout.write('sem ytInitialData:\n');
{
  const result = await extractSubscriptions(1000, null);
  check('falha declarada, sem canais', result.ok === false && result.channels.length === 0, result.reason ?? '');
}

process.stdout.write(failures === 0 ? '\nTUDO OK\n' : `\n${failures} FALHA(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
