/**
 * Página mínima do feed, no formato do HTML real.
 *
 * O extrator lê o JSON embutido (`var ytInitialData = …`) e o carimbo de build
 * vem do `ytcfg` — as duas coisas que a home de verdade carrega. O card usa a
 * forma nova (`yt-lockup-view-model`), a que o feed serve hoje.
 */
export const FEED_BUILD_LABEL = 'youtube.desktop.web_20261002_10_RC00';

const ytInitialData = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              richGridRenderer: {
                contents: [
                  {
                    richItemRenderer: {
                      content: {
                        lockupViewModel: {
                          contentId: 'dSF9MWuB0F0',
                          contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                          metadata: {
                            lockupMetadataViewModel: {
                              title: { content: 'Um vídeo de verdade' },
                              metadata: {
                                contentMetadataViewModel: {
                                  metadataRows: [
                                    {
                                      metadataParts: [{ text: { content: 'Mateus Dias' } }],
                                    },
                                    {
                                      metadataParts: [
                                        { text: { content: '557 visualizações' } },
                                        { text: { content: 'há 2 h' } },
                                      ],
                                    },
                                  ],
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

export const FEED_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>YouTube</title>
<script nonce="teste">var ytcfg = {"PAGE_BUILD_LABEL":"${FEED_BUILD_LABEL}"};</script>
</head>
<body>
<div id="page-manager"></div>
<script nonce="teste">var ytInitialData = ${JSON.stringify(ytInitialData)};</script>
</body>
</html>`;
