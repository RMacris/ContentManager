/**
 * Catálogo dos canais inscritos do YouTube.
 *
 * Na página `youtube.com/feed/channels`, guarda o que os cards de canal
 * mostram e manda o lote para o service worker, que mescla com o catálogo
 * local. A varredura roda de novo a cada card novo (scroll); o worker evita
 * gravar o que não mudou.
 *
 * Este é um adaptador próprio do runtime da página, não parte do filtro de
 * idade: colecionar inscrições não depende de nenhum dos três interruptores e
 * continua funcionando com todos desligados, enquanto o filtro só varre o
 * feed quando tem algo a fazer.
 *
 * Script clássico, sem import/export, como os outros content scripts. A
 * leitura do card mora em `youtube-dom.js`; aqui ficam só a chave, a
 * assinatura e a mensagem.
 */
(function (root) {
  'use strict';

  // A leitura do DOM do YouTube vem de `youtube-dom.js`, carregado antes deste
  // arquivo; o catálogo não conhece seletores.
  const youtubeDom = typeof root.YTIYouTubeDom !== 'undefined' ? root.YTIYouTubeDom : null;
  if (youtubeDom === null || youtubeDom === undefined) return;

  // O ciclo da página vem de `content-runtime.js`, carregado antes deste
  // arquivo; o catálogo só registra o próprio scan.
  const runtimeCore = typeof root.YTIContentRuntime !== 'undefined' ? root.YTIContentRuntime : null;
  if (runtimeCore === null || runtimeCore === undefined) return;

  // Recarregar a extensão órfã os scripts antigos: a guarda evita um segundo
  // coletor e a reinjeção revive a aba sem refresh.
  const running = root.__ytiChannelCatalogAlive;
  if (typeof running === 'function' && running()) return;
  root.__ytiChannelCatalogAlive = runtimeCore.isExtensionAlive;

  let collectedChannels = new Map();
  let lastCatalogSignature = '';

  function shouldScan() {
    return youtubeDom.isChannelsPage(location.pathname);
  }

  /** Na página de inscrições, guarda o que os cards de canal mostram. */
  function collectSubscribedChannels() {
    const items = document.querySelectorAll(youtubeDom.selectors.subscriptionCard);
    let changed = false;

    for (let i = 0; i < items.length; i += 1) {
      const channel = youtubeDom.readSubscribedChannel(items[i]);
      if (channel === null) continue;

      const key = (channel.handle || channel.name).toLowerCase();
      const previous = collectedChannels.get(key);
      if (
        previous === undefined ||
        previous.name !== channel.name ||
        previous.handle !== channel.handle ||
        previous.avatarUrl !== channel.avatarUrl
      ) {
        collectedChannels.set(key, {
          name: channel.name,
          handle: channel.handle,
          avatarUrl: channel.avatarUrl,
        });
        changed = true;
      }
    }

    if (!changed) return;
    const signature = Array.from(collectedChannels.keys()).sort().join('\u0001');
    if (signature === lastCatalogSignature) return;
    lastCatalogSignature = signature;

    try {
      chrome.runtime
        .sendMessage({ action: 'saveChannelCatalog', channels: Array.from(collectedChannels.values()) })
        .catch(() => {});
    } catch (error) {
      // Contexto invalidado (extensão recarregada): a próxima injeção resolve.
    }
  }

  function scan() {
    collectSubscribedChannels();
  }

  runtimeCore.register({
    scan,
    shouldScan,
    // A coleta acompanha o scroll com o mesmo piso do filtro.
    minScanIntervalMs: 500,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
