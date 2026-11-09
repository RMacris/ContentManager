/**
 * Reaplica o filtro do YouTube nas abas que já estavam abertas.
 *
 * Recarregar a extensão órfã os content scripts das abas existentes: o
 * contexto deles é invalidado, o listener de `storage.onChanged` morre e nada
 * mais responde até a página ser atualizada. Com a injeção, o filtro volta ao
 * vivo na hora — ligar o interruptor no popup passa a valer sem refresh, como
 * nas abas abertas depois.
 *
 * A injeção é idempotente: os arquivos puros apenas recriam o global e o
 * filtro tem guarda contra dupla execução. O `block-guard.js` fica de fora de
 * propósito — ele não é idempotente e o bloqueio de navegação é do
 * `declarativeNetRequest`, que nunca depende de script vivo.
 */
const FILTER_SCRIPTS = [
  'src/content/age-core.js',
  'src/content/keyword-core.js',
  'src/content/channel-rules.js',
  'src/content/content-runtime.js',
  'src/content/channel-button.js',
  'src/content/age-filter.js',
];

export async function injectFilterIntoOpenTabs() {
  if (!chrome.tabs || !chrome.scripting) return;

  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    const injections = [];
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      injections.push(injectIntoTab(tab.id));
    }
    await Promise.all(injections);
  } catch (error) {
    // Sem permissão ou sem abas acessíveis: não há o que reviver.
    console.warn('Could not re-inject the YouTube filter into open tabs.', error);
  }
}

async function injectIntoTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [...FILTER_SCRIPTS] });
  } catch (error) {
    // Aba descartada, carregando ou sem permissão: o refresh da página resolve.
    console.warn('Could not re-inject the YouTube filter into an open tab.', error);
  }
}
