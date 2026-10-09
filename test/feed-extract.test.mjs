/**
 * Teste do extrator de cards.
 *
 * O extrator roda no mundo MAIN da página e lê `window.ytInitialData`. Aqui o
 * `window` é um objeto comum, então dá para exercitar a lógica inteira sem abrir
 * navegador nenhum — que é o ponto: o que quebra com facilidade é o caminho dos
 * campos, não a integração com o Chrome.
 *
 * O payload abaixo reproduz a estrutura verbatim capturada na inspeção ao vivo
 * registrada no ticket 04 do mapa (build youtube.desktop.web_20261002_10_RC00).
 */
import { extractFeedCards, parseInitialDataFromHtml, scrollThreeViewports } from '../src/injected/feed-extract.js';

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

/** Card novo (`yt-lockup-view-model`), no formato do feed. */
function lockupVideo(id, title, channel, date, avatarUrl) {
  return {
    lockupViewModel: {
      contentId: id,
      contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      metadata: {
        lockupMetadataViewModel: {
          title: { content: title },
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [
                {
                  metadataParts: [
                    {
                      text: { content: channel },
                      icon: { name: 'CHECK_CIRCLE_FILLED', accessibilityLabel: 'Verificado' },
                    },
                  ],
                },
                {
                  metadataParts: [
                    {
                      text: { content: '557' },
                      accessibilityLabel: '557 visualizações',
                      leadingIcon: { name: 'PLAY_ARROW_OUTLINED', height: 12, width: 12 },
                    },
                    { text: { content: date }, accessibilityLabel: date },
                  ],
                },
              ],
            },
          },
          ...(avatarUrl
            ? {
                image: {
                  decoratedAvatarViewModel: {
                    avatar: {
                      avatarViewModel: { image: { sources: [{ url: avatarUrl, width: 68, height: 68 }] } },
                    },
                  },
                },
              }
            : {}),
        },
      },
    },
  };
}

const ytInitialData = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              richGridRenderer: {
                contents: [
                  { richItemRenderer: { content: lockupVideo(
                    'dSF9MWuB0F0',
                    'Um vídeo de verdade',
                    'Mateus Dias',
                    'há 2 h',
                    'https://yt3.ggpht.com/avatar-68.jpg',
                  ) } },
                  // Anúncio: também chega como um card por fora. Não pode entrar.
                  { richItemRenderer: { content: { adSlotRenderer: {
                    adSlotMetadata: { slotId: 'slot-1' },
                    fulfillmentContent: { lockupViewModel: {
                      contentId: 'ANUNCIO01',
                      contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                      metadata: { lockupMetadataViewModel: { title: { content: 'Compre agora' } } },
                    } },
                  } } } },
                  // Shorts: outro formato, não é vídeo do feed.
                  { richItemRenderer: { content: { shortsLockupViewModel: {
                    entityId: 'shorts-abc',
                    overlayMetadata: { primaryText: { content: 'Um Short' } },
                  } } } },
                  // Playlist: lockup igual, mas contentType diferente.
                  { richItemRenderer: { content: { lockupViewModel: {
                    contentId: 'PLxyz',
                    contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
                    metadata: { lockupMetadataViewModel: { title: { content: 'Uma playlist' } } },
                  } } } },
                  // Card sem avatar: acontece na grade de um canal. Não é defeito.
                  { richItemRenderer: { content: lockupVideo(
                    'semAvatar1',
                    'Sem avatar',
                    'Canal Sem Foto',
                    'há 5 dias',
                    null,
                  ) } },
                  // Formato antigo, que ainda aparece em outras superfícies.
                  { richItemRenderer: { content: { videoRenderer: {
                    videoId: 'legacyId1',
                    title: { runs: [{ text: 'Vídeo no formato antigo' }] },
                    longBylineText: { runs: [{ text: 'Canal Antigo' }] },
                    publishedTimeText: { simpleText: 'há 3 dias' },
                    channelThumbnailSupportedRenderers: {
                      channelThumbnailWithLinkRenderer: {
                        thumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/legacy-avatar.jpg' }] },
                      },
                    },
                  } } } },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

globalThis.window = {
  ytInitialData,
  ytcfg: { get: (key) => (key === 'PAGE_BUILD_LABEL' ? 'youtube.desktop.web_20261002_10_RC00' : null) },
  innerHeight: 900,
  scrollBy: () => {},
};

process.stdout.write('extração de cards do feed:\n');

const result = extractFeedCards(30);
check('extração bem-sucedida', result.ok === true, String(result.reason));
check('build label lido', result.buildLabel === 'youtube.desktop.web_20261002_10_RC00');

const ids = result.cards.map((c) => c.videoId);
check('anúncio não entrou', !ids.includes('ANUNCIO01'));
check('Shorts não entrou', !ids.includes('shorts-abc'));
check('playlist não entrou', !ids.includes('PLxyz'));
check('três vídeos extraídos', result.cards.length === 3, `veio ${result.cards.length}: ${ids.join(', ')}`);
check('ordem preservada (topo primeiro)', ids[0] === 'dSF9MWuB0F0', ids.join(', '));

const first = result.cards[0];
check('id do vídeo', first.videoId === 'dSF9MWuB0F0');
check('título', first.title === 'Um vídeo de verdade', first.title);
check('canal', first.channelName === 'Mateus Dias', first.channelName);
check('data (última parte da última linha)', first.publishedText === 'há 2 h', first.publishedText);
check('avatar', first.channelAvatarUrl === 'https://yt3.ggpht.com/avatar-68.jpg', String(first.channelAvatarUrl));
check(
  'thumbnail montada em alta',
  first.thumbnailUrl === 'https://i.ytimg.com/vi/dSF9MWuB0F0/hq720.jpg',
  first.thumbnailUrl,
);
check('url do vídeo', first.url === 'https://www.youtube.com/watch?v=dSF9MWuB0F0', first.url);

const noAvatar = result.cards.find((c) => c.videoId === 'semAvatar1');
check('card sem avatar extraído mesmo assim', noAvatar !== undefined);
check('avatar ausente vira null', noAvatar && noAvatar.channelAvatarUrl === null);
check('data do card sem avatar', noAvatar && noAvatar.publishedText === 'há 5 dias');

const legacy = result.cards.find((c) => c.videoId === 'legacyId1');
check('formato antigo extraído', legacy !== undefined);
check('canal do formato antigo', legacy && legacy.channelName === 'Canal Antigo');
check('data do formato antigo', legacy && legacy.publishedText === 'há 3 dias');
check(
  'avatar do formato antigo',
  legacy && legacy.channelAvatarUrl === 'https://yt3.ggpht.com/legacy-avatar.jpg',
);

process.stdout.write('teto de cards:\n');
const capped = extractFeedCards(1);
check('teto respeitado', capped.cards.length === 1, `veio ${capped.cards.length}`);

process.stdout.write('payload ausente:\n');
delete globalThis.window.ytInitialData;
const missing = extractFeedCards(30);
check('sem ytInitialData devolve falha explícita', missing.ok === false, String(missing.reason));

process.stdout.write('dados passados explicitamente (rota sem aba):\n');
const viaData = extractFeedCards(30, ytInitialData);
check(
  'extrai igual pelo caminho explícito',
  viaData.ok === true && viaData.cards.length === 3,
  `veio ${viaData.cards.length}`,
);

process.stdout.write('ytInitialData embutido no HTML:\n');
const html = `<script>var ytInitialData = ${JSON.stringify(ytInitialData)};</script>`;
const parsedHtml = parseInitialDataFromHtml(html);
check('JSON embutido foi parseado', parsedHtml !== null && typeof parsedHtml === 'object');
const fromHtml = parsedHtml ? extractFeedCards(30, parsedHtml) : null;
check(
  'cards extraídos do HTML batem com os da página',
  fromHtml && fromHtml.ok === true && fromHtml.cards.length === 3,
  fromHtml ? `veio ${fromHtml.cards.length}` : 'sem parse',
);

const tricky = { x: { y: '}{' }, s: 'ele disse "oi"' };
const trickyHtml = `<script>var ytInitialData = ${JSON.stringify(tricky)};</script>`;
const trickyParsed = parseInitialDataFromHtml(trickyHtml);
check(
  'parser respeita chaves e aspas dentro de strings',
  trickyParsed && trickyParsed.x && trickyParsed.x.y === '}{' && trickyParsed.s === 'ele disse "oi"',
  JSON.stringify(trickyParsed),
);
check('HTML sem o marcador devolve null', parseInitialDataFromHtml('<html>nada</html>') === null);

process.stdout.write('rolagem de reserva:\n');
globalThis.window.innerHeight = 800;
let scrolled = 0;
globalThis.window.scrollBy = (_x, y) => {
  scrolled += y;
};
const scroll = scrollThreeViewports();
check('rola três telas', scrolled === 2400, String(scrolled));
check('devolve o que rolou', scroll.scrolledPixels === 2400);

process.stdout.write(failures === 0 ? '\nTUDO OK\n' : `\n${failures} FALHA(S)\n`);
process.exitCode = failures === 0 ? 0 : 1;
