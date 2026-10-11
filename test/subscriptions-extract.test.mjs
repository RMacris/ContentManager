/**
 * Teste da extração das inscrições do YouTube.
 *
 * O payload de referência é a forma real do `channelRenderer` (medida em um
 * resultado de busca por canal, 11/10/2026): `channelId`, `title`, o handle em
 * `navigationEndpoint.browseEndpoint.canonicalBaseUrl` e a contagem de inscritos
 * em `videoCountText` — com `subscriberCountText` carregando o próprio `@handle`.
 * É a mesma forma que a grade da página de inscrições usa.
 *
 * O `chrome` não entra aqui: a função é pura sobre o JSON, como o `feed-extract`.
 */
import { extractSubscriptions } from '../src/injected/subscriptions-extract.js';

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
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
function pageWith(items, { continuation = false } = {}) {
  const contents = [{ gridRenderer: { items } }];
  if (continuation) {
    contents.push({
      continuationItemRenderer: {
        trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
        continuationEndpoint: {
          clickTrackingParams: 'CBQQ6TgYACITCPv0kZqIsZcDFQIG7AodR3wBbQ==',
          continuationCommand: { token: 'CONTINUATION_TOKEN_DE_EXEMPLO', request: 'CONTINUATION_REQUEST_TYPE_BROWSE' },
        },
      },
    });
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

process.stdout.write('extração das inscrições da página:\n');
{
  const data = pageWith([
    { channelRenderer: channelRenderer(FIRESHIP) },
    { channelRenderer: channelRenderer(OUTRA) },
  ]);
  const result = extractSubscriptions(1000, data);

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

  const result = extractSubscriptions(1000, pageWith([{ channelRenderer: withoutCanonical }, { channelRenderer: byText }]));

  check('handle lido da URL do comando', result.channels[0].handle === 'devemdobro', String(result.channels[0].handle));
  check('handle lido do subscriberCountText', result.channels[1].handle === 'Fireship', String(result.channels[1].handle));
}

process.stdout.write('canal sem handle continua na lista:\n');
{
  const semHandle = channelRenderer({ ...OUTRA, handle: null });
  const result = extractSubscriptions(1000, pageWith([{ channelRenderer: semHandle }]));

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
  const result = extractSubscriptions(1000, data);

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
  const result = extractSubscriptions(1000, data);

  check('só a inscrição entrou', result.channels.length === 1, String(result.channels.length));
  check('e é o canal certo', result.channels[0].channelId === FIRESHIP.id);
}

process.stdout.write('teto e indicação de continuação:\n');
{
  const data = pageWith(
    [{ channelRenderer: channelRenderer(FIRESHIP) }, { channelRenderer: channelRenderer(OUTRA) }],
    { continuation: true },
  );
  const result = extractSubscriptions(1, data);

  check('respeitou o teto', result.channels.length === 1, String(result.channels.length));
  check('a página indicou que há mais', result.hasMore === true);
}

process.stdout.write('sem ytInitialData:\n');
{
  const result = extractSubscriptions(1000, null);
  check('falha declarada, sem canais', result.ok === false && result.channels.length === 0, result.reason ?? '');
}

process.stdout.write(failures === 0 ? '\nTUDO OK\n' : `\n${failures} FALHA(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
