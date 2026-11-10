/**
 * Alimentação única das configurações para os content scripts do YouTube.
 *
 * O filtro de idade, o modo só inscrições e o chip de canal leem as mesmas
 * preferências. Antes cada um chamava `chrome.storage.sync.get`, repetia os
 * padrões e registrava o próprio `onChanged`; agora este módulo é o único dono
 * da leitura, dos listeners e da forma normalizada, e os adaptadores só assinam.
 *
 * A ordem também mora aqui: uma mudança que chega antes da leitura inicial
 * vence a leitura (o callback velho é descartado). Assim o filtro nunca volta
 * para um estado anterior por causa de uma resposta atrasada do storage.
 *
 * O catálogo de inscrições vive no `storage.local` (nome, handle e foto) e
 * chega junto das preferências: o filtro precisa dele para o modo "só
 * inscrições" sem uma segunda leitura nem uma mensagem ao service worker.
 *
 * Script clássico de propósito, como os outros content scripts: o popup e o
 * service worker continuam lendo o `settings-contract.js` diretamente.
 */
(function (root) {
  'use strict';

  // O schema (padrões, chaves e normalização) vem de `settings-contract.js`,
  // carregado antes deste arquivo; o feed não mantém uma segunda cópia.
  const contract = typeof root.YTISettingsContract !== 'undefined' ? root.YTISettingsContract : null;
  if (contract === null || contract === undefined) return;

  // O ciclo do runtime é dos content scripts; a guarda de contexto órfão é a
  // mesma dos adaptadores, para uma reinjeção não criar um segundo listener.
  const runtimeCore = typeof root.YTIContentRuntime !== 'undefined' ? root.YTIContentRuntime : null;
  if (runtimeCore === null || runtimeCore === undefined) return;

  const running = root.__ytiContentSettingsAlive;
  if (typeof running === 'function' && running()) return;
  root.__ytiContentSettingsAlive = runtimeCore.isExtensionAlive;

  /** As chaves que a leitura inicial precisa devolver, inclusive as listas. */
  const READ_DEFAULTS = buildReadDefaults();
  const READ_CATALOG_DEFAULTS = Object.freeze({ channelCatalog: null });

  const subscribers = [];
  let current = contract.normalizeSettings({});
  let subscribedChannels = [];
  let revision = 0;
  let loaded = false;
  let readStarted = false;

  function buildReadDefaults() {
    const defaults = { ...contract.DEFAULT_SETTINGS };
    // `null` revela se a chave existe: com o padrão de horas aqui, a leitura de
    // uma aba aberta antes da migração esconderia a chave antiga em dias.
    defaults.maxAgeHours = null;
    defaults[contract.LEGACY_AGE_KEY] = null;
    for (let i = 0; i < contract.LIST_KEYS.length; i += 1) defaults[contract.LIST_KEYS[i]] = null;
    defaults[contract.SELECTED_LIST_KEY] = null;
    defaults[contract.ALLOWED_LIST_KEY] = null;
    return defaults;
  }

  /** O que cada assinante recebe: preferências + canais inscritos. */
  function snapshot() {
    return { ...current, subscribedChannels: subscribedChannels.slice() };
  }

  function deliver(listener) {
    try {
      listener(snapshot());
    } catch (error) {
      // Um adaptador quebrado não pode impedir o outro de receber o estado.
    }
  }

  function notify() {
    const listeners = subscribers.slice();
    for (let i = 0; i < listeners.length; i += 1) deliver(listeners[i]);
  }

  function sameCatalog(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].name !== b[i].name || a[i].handle !== b[i].handle) return false;
    }
    return true;
  }

  /**
   * As entradas do catálogo sem a foto: o filtro só usa nome e handle. O
   * catálogo já é limpo e sem repetidos quando é gravado pelo service worker;
   * aqui basta projetar os dois campos, sem repetir a deduplicação O(n²) a
   * cada carregamento de página.
   */
  function normalizeCatalog(catalog) {
    if (catalog === null || typeof catalog !== 'object' || !Array.isArray(catalog.channels)) {
      return [];
    }
    const list = [];
    for (let i = 0; i < catalog.channels.length; i += 1) {
      const entry = catalog.channels[i];
      if (entry === null || typeof entry !== 'object') continue;
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const handle = typeof entry.handle === 'string' ? entry.handle.trim() : '';
      if (name === '' && handle === '') continue;
      list.push({ name, handle });
    }
    return list;
  }

  /**
   * Lê o storage uma vez e entrega o estado normalizado. As preferências e o
   * catálogo são lidos em paralelo; a primeira entrega espera os dois para o
   * filtro não achar que o modo está sem canais no meio da leitura. Se uma
   * mudança chegou durante a leitura, o resultado dela já é mais novo: o
   * callback velho não sobrescreve as preferências.
   */
  function read() {
    if (readStarted) return;
    readStarted = true;
    const revisionAtStart = revision;
    let pending = 2;
    let savedSettings = READ_DEFAULTS;
    let savedCatalog = null;

    const finish = () => {
      pending -= 1;
      if (pending > 0) return;
      loaded = true;

      const stale = revision !== revisionAtStart;
      const nextCatalog = normalizeCatalog(savedCatalog);
      const catalogChanged = !sameCatalog(subscribedChannels, nextCatalog);
      if (!stale) current = contract.normalizeSettings(savedSettings);
      subscribedChannels = nextCatalog;

      // Uma mudança que chegou antes da leitura já entregou o estado novo; se
      // o catálogo também não mudou, não há nada de novo para avisar.
      if (stale && !catalogChanged) return;
      notify();
    };

    try {
      chrome.storage.sync.get(READ_DEFAULTS, (saved) => {
        const failed = typeof chrome.runtime !== 'undefined' && chrome.runtime.lastError;
        savedSettings = failed ? READ_DEFAULTS : saved;
        finish();
      });
    } catch (error) {
      savedSettings = READ_DEFAULTS;
      finish();
    }

    try {
      chrome.storage.local.get(READ_CATALOG_DEFAULTS, (saved) => {
        const failed = typeof chrome.runtime !== 'undefined' && chrome.runtime.lastError;
        savedCatalog = failed ? null : saved.channelCatalog;
        finish();
      });
    } catch (error) {
      savedCatalog = null;
      finish();
    }
  }

  /**
   * Assina o estado normalizado. Um assinante que chega depois da leitura
   * recebe o estado atual na hora; um que chega antes recebe na primeira
   * leitura e a cada mudança.
   */
  function subscribe(listener) {
    if (typeof listener !== 'function') return function unsubscribe() {};
    subscribers.push(listener);
    read();
    if (loaded) deliver(listener);

    return function unsubscribe() {
      const index = subscribers.indexOf(listener);
      if (index !== -1) subscribers.splice(index, 1);
    };
  }

  function listenForChanges() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (!Object.prototype.hasOwnProperty.call(changes, 'channelCatalog')) return;
        subscribedChannels = normalizeCatalog(changes.channelCatalog.newValue);
        loaded = true;
        notify();
        return;
      }
      if (area !== 'sync') return;

      let touched = false;
      for (let i = 0; i < contract.SETTING_KEYS.length; i += 1) {
        const key = contract.SETTING_KEYS[i];
        if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
        current[key] = changes[key].newValue;
        touched = true;
      }
      if (!touched) return;

      revision += 1;
      loaded = true;
      current = contract.normalizeSettings(current);
      notify();
    });
  }

  listenForChanges();
  read();

  root.YTIContentSettings = Object.freeze({ subscribe });
})(typeof globalThis !== 'undefined' ? globalThis : this);
