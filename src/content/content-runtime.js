/**
 * Ciclo de vida compartilhado dos content scripts do YouTube.
 *
 * O filtro de idade e o botão de canal precisam da mesma rotina de página:
 * observar a árvore, escutar a navegação da SPA, reagir à visibilidade, varrer
 * de tempos em tempos e desligar quando o contexto da extensão morre (a
 * instância órfã de uma extensão recarregada). Este módulo é o único dono dessa
 * rotina; cada script registra um adaptador com o próprio `scan` e, quando
 * precisa, `shouldScan` e `onStop`.
 *
 * O runtime é único por página: a segunda injeção não cria um segundo
 * observer nem um segundo intervalo, só registra o seu adaptador. Se a
 * instância anterior ficou órfã, a reinjeção a substitui.
 *
 * Script clássico, sem import/export, como os outros content scripts.
 */
(function (root) {
  'use strict';

  /** O contexto desta instância ainda fala com a extensão? */
  function isExtensionAlive() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime) && Boolean(chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  // Reexecutar o arquivo (reinjeção) não pode duplicar o loop. Uma instância
  // viva é mantida; uma órfã é parada e substituída pela nova.
  const previous = root.YTIContentRuntime;
  if (
    previous !== null &&
    previous !== undefined &&
    typeof previous.isExtensionAlive === 'function' &&
    previous.isExtensionAlive()
  ) {
    return;
  }
  if (previous !== null && previous !== undefined && typeof previous.stop === 'function') {
    try {
      previous.stop();
    } catch (error) {
      // A instância velha já não tem contexto; a nova assume o DOM.
    }
  }

  const SWEEP_INTERVAL_MS = 2000;
  const DEFAULT_MIN_SCAN_INTERVAL_MS = 500;

  const adapters = [];
  let started = false;
  let stopped = false;
  let domWatched = false;
  let domObserver = null;
  let sweepTimer = null;

  /** A aba está em segundo plano? Nenhuma varredura toca no DOM nesse estado. */
  function isDocumentHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  /**
   * Instância órfã não pode ficar brigando com a nova: quando o contexto morre
   * (extensão recarregada), os timers e o observer param na próxima volta.
   */
  function stopIfOrphaned() {
    if (stopped) return true;
    if (isExtensionAlive()) return false;
    stop();
    return true;
  }

  function stop() {
    if (stopped) return;
    stopped = true;

    for (let i = 0; i < adapters.length; i += 1) {
      const timer = adapters[i].scanTimer;
      if (timer !== null && timer !== undefined) {
        clearTimeout(timer);
        adapters[i].scanTimer = null;
      }
    }
    if (sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    if (domObserver !== null) {
      domObserver.disconnect();
      domObserver = null;
    }

    // Cada adaptador limpa o que criou (o chip remove os próprios botões);
    // um deles falhar não impede o outro de parar.
    for (let i = 0; i < adapters.length; i += 1) {
      if (typeof adapters[i].onStop !== 'function') continue;
      try {
        adapters[i].onStop();
      } catch (error) {
        // O contexto já morreu; não há o que restaurar.
      }
    }
  }

  function shouldScanAdapter(adapter) {
    if (typeof adapter.shouldScan !== 'function') return true;
    try {
      return adapter.shouldScan() !== false;
    } catch (error) {
      return false;
    }
  }

  /** Uma varredura só acontece com a aba visível e com o adaptador ativo. */
  function runAdapter(adapter) {
    if (isDocumentHidden()) return;
    if (!shouldScanAdapter(adapter)) return;
    adapter.scan();
  }

  /** Agenda uma varredura do adaptador, respeitando o piso dele. */
  function scheduleAdapter(adapter) {
    if (stopped) return;
    if (adapter.scanTimer !== null && adapter.scanTimer !== undefined) return;
    if (!shouldScanAdapter(adapter)) return;

    const floor = adapter.minScanIntervalMs > 0 ? adapter.minScanIntervalMs : DEFAULT_MIN_SCAN_INTERVAL_MS;
    const wait = Math.max(0, floor - (Date.now() - adapter.lastScanAt));
    adapter.scanTimer = setTimeout(() => {
      adapter.scanTimer = null;
      adapter.lastScanAt = Date.now();
      if (stopIfOrphaned()) return;
      runAdapter(adapter);
    }, wait);
  }

  /** Agenda todos os adaptadores; é o gatilho do observer e da navegação. */
  function scheduleScan() {
    if (stopIfOrphaned()) return;
    for (let i = 0; i < adapters.length; i += 1) scheduleAdapter(adapters[i]);
  }

  /**
   * A varredura periódica: pega o card que envelheceu sem mudança de nó. Também
   * é a volta em que uma instância órfã percebe o contexto morto.
   */
  function sweep() {
    if (stopIfOrphaned()) return;
    if (isDocumentHidden()) return;
    for (let i = 0; i < adapters.length; i += 1) runAdapter(adapters[i]);
  }

  /**
   * O YouTube é uma SPA e o feed carrega em pedaços: observa a árvore, escuta
   * a navegação e ainda varre de tempos em tempos, porque o card pode trocar o
   * texto no lugar sem criar nó novo.
   */
  function watchDom() {
    if (domWatched || stopped) return;
    const rootNode = document.documentElement;
    if (rootNode === null || rootNode === undefined) {
      document.addEventListener('DOMContentLoaded', watchDom, { once: true });
      return;
    }
    domWatched = true;
    domObserver = new MutationObserver(scheduleScan);
    domObserver.observe(rootNode, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', scheduleScan);
    document.addEventListener('visibilitychange', () => {
      if (!isDocumentHidden()) scheduleScan();
    });
  }

  function start() {
    if (started || stopped) return;
    started = true;
    watchDom();
    if (!stopped) sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  }

  /**
   * Registra um adaptador e devolve o gatilho do próprio adaptador. Registrar
   * depois do primeiro adaptador só acrescenta o novo scan ao mesmo loop.
   */
  function register(adapter) {
    const handle = {
      schedule() {
        if (stopIfOrphaned()) return;
        scheduleAdapter(adapter);
      },
      stop,
    };

    adapter.scanTimer = null;
    adapter.lastScanAt = 0;
    if (typeof adapter.minScanIntervalMs !== 'number' || !(adapter.minScanIntervalMs > 0)) {
      adapter.minScanIntervalMs = DEFAULT_MIN_SCAN_INTERVAL_MS;
    }

    // Contexto já morto: nem observer nem timer nascem; o adaptador só limpa
    // o que tiver criado antes do registro.
    if (stopped || !isExtensionAlive()) {
      stop();
      if (typeof adapter.onStop === 'function') adapter.onStop();
      return handle;
    }

    adapters.push(adapter);
    start();
    scheduleAdapter(adapter);
    return handle;
  }

  root.YTIContentRuntime = {
    isExtensionAlive,
    register,
    scheduleScan,
    stop,
    isRunning() {
      return started && !stopped;
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
