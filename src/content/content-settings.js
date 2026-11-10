/**
 * Alimentação única das configurações para os content scripts do YouTube.
 *
 * O filtro de idade e o chip de canal leem as mesmas preferências. Antes cada
 * um chamava `chrome.storage.sync.get`, repetia os padrões e registrava o
 * próprio `onChanged`; agora este módulo é o único dono da leitura, do
 * listener e da forma normalizada, e os adaptadores só assinam.
 *
 * A ordem também mora aqui: uma mudança que chega antes da leitura inicial
 * vence a leitura (o callback velho é descartado). Assim o filtro nunca volta
 * para um estado anterior por causa de uma resposta atrasada do storage.
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

  const subscribers = [];
  let current = contract.normalizeSettings({});
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
    defaults[contract.ALLOWED_LIST_KEY] = null;
    return defaults;
  }

  function deliver(listener) {
    try {
      listener(current);
    } catch (error) {
      // Um adaptador quebrado não pode impedir o outro de receber o estado.
    }
  }

  function notify() {
    const listeners = subscribers.slice();
    for (let i = 0; i < listeners.length; i += 1) deliver(listeners[i]);
  }

  /**
   * Lê o storage uma vez e entrega o estado normalizado. Se uma mudança chegou
   * durante a leitura, o resultado dela já é mais novo: o callback é ignorado.
   */
  function read() {
    if (readStarted) return;
    readStarted = true;
    const revisionAtStart = revision;

    const finish = (saved) => {
      loaded = true;
      if (revision !== revisionAtStart) return;
      current = contract.normalizeSettings(saved);
      notify();
    };

    try {
      chrome.storage.sync.get(READ_DEFAULTS, (saved) => {
        const failed = typeof chrome.runtime !== 'undefined' && chrome.runtime.lastError;
        finish(failed ? READ_DEFAULTS : saved);
      });
    } catch (error) {
      finish(READ_DEFAULTS);
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
