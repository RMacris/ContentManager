/**
 * A aba própria da automação: abrir, esperar, extrair, fechar.
 *
 * Princípio que governa este arquivo: **a automação não mexe no que é do usuário.**
 * Toda coleta usa uma aba própria, aberta em segundo plano e fechada ao fim — aba
 * que o usuário abriu nunca é consultada, selecionada, navegada nem fechada.
 *
 * A posse da aba é registrada em `chrome.storage.session` sob uma chave **por
 * finalidade** (colheita do feed, coleta de inscrições): se o worker morrer no meio
 * de uma rodada, a aba fica; a rodada seguinte da mesma finalidade reaproveita e
 * fecha essa aba, em vez de acumular outra — e as duas finalidades não competem
 * pela mesma aba.
 */

/**
 * Espera a aba terminar de carregar, com teto de tempo.
 *
 * `expectedUrl` é o critério de aceitação: uma aba marcada como completa na
 * página antiga (a corrida da aba reaproveitada) não conta. Em `ignoreInitial`,
 * nem o estado inicial vale — só um evento de `complete` da navegação nova,
 * porque a carga que nos interessa é a que a chamada de `update` disparou.
 */
export function waitForComplete(tabId, expectedUrl, ignoreInitial = false, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    };

    const listener = (changedId, info) => {
      if (changedId !== tabId || info.status !== 'complete') return;
      // Confere a URL de novo: redirect para consentimento/login não é a página.
      chrome.tabs.get(changedId).then(
        (tab) => {
          if (tab && tab.url === expectedUrl) finish(true);
        },
        () => {},
      );
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);

    // A aba pode já estar completa quando chegamos aqui — mas só vale se for a
    // página que esperamos, e nunca no caso de navegação recém disparada.
    if (!ignoreInitial) {
      chrome.tabs.get(tabId).then(
        (tab) => {
          if (tab.status === 'complete' && tab.url === expectedUrl) finish(true);
        },
        () => finish(false),
      );
    }
  });
}

/** O id da aba própria de uma finalidade, registrado para o caso de morte no meio. */
export async function readOwnedTabId(key) {
  const stored = await chrome.storage.session.get({ [key]: null });
  return stored[key];
}

export async function rememberOwnedTab(key, tabId) {
  await chrome.storage.session.set({ [key]: tabId });
}

export async function forgetOwnedTab(key, tabId) {
  const stored = await readOwnedTabId(key);
  if (stored === tabId) await chrome.storage.session.remove(key);
}

/** Lê a aba sem lançar: null quando ela já não existe. */
export async function getTabOrNull(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/**
 * Diagnóstico de foco: mede se criar/navegar a aba própria mexe na janela.
 * A aba nasce com `active:false`; o registro prova — ou desmente — que ela não
 * veio para primeiro plano. Nunca lança: API indisponível vira `null`.
 */
async function focusBefore() {
  try {
    const win = await chrome.windows.getLastFocused();
    return {
      windowId: typeof win.id === 'number' ? win.id : null,
      focused: typeof win.focused === 'boolean' ? win.focused : null,
    };
  } catch {
    return { windowId: null, focused: null };
  }
}

async function focusAfter(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const win = await chrome.windows.get(tab.windowId);
    return {
      tabActive: tab.active === true,
      windowFocused: typeof win.focused === 'boolean' ? win.focused : null,
    };
  } catch {
    return { tabActive: null, windowFocused: null };
  }
}

/**
 * Devolve a aba própria de uma finalidade: reaproveita a que ficou de uma rodada
 * interrompida, senão abre uma nova **em segundo plano** — abrir em primeiro
 * plano arrancaria o usuário do que ele está fazendo. Aba do usuário não entra
 * na conta: a extensão não navega nem lê aquilo que ela não abriu.
 */
export async function ensureOwnedTab({ url, key }) {
  const ownedId = await readOwnedTabId(key);
  if (typeof ownedId === 'number') {
    const owned = await getTabOrNull(ownedId);
    if (owned) {
      const before = await focusBefore();
      await chrome.tabs.update(ownedId, { url });
      const after = await focusAfter(ownedId);
      // Navegação recém-disparada: a página antiga ainda se diz completa, então
      // só um `complete` da navegação nova vale.
      await waitForComplete(ownedId, url, true);
      return { tabId: ownedId, reused: true, focus: { before, after } };
    }
    await forgetOwnedTab(key, ownedId);
  }

  const before = await focusBefore();
  const created = await chrome.tabs.create({ url, active: false });
  if (typeof created.id !== 'number') {
    throw new Error('não foi possível abrir a aba própria');
  }
  const after = await focusAfter(created.id);
  await rememberOwnedTab(key, created.id);
  await waitForComplete(created.id, url);
  return { tabId: created.id, reused: false, focus: { before, after } };
}

/**
 * Fecha a aba própria. "Já não existe" é sucesso; falha de verdade devolve
 * `closed: false` **e mantém a posse**, para a próxima rodada tentar de novo em
 * vez de deixar a aba órfã para sempre.
 */
export async function closeOwnedTab(tabId, key) {
  try {
    await chrome.tabs.remove(tabId);
    await forgetOwnedTab(key, tabId);
    return { closed: true };
  } catch (error) {
    if (await getTabOrNull(tabId)) {
      return { closed: false, reason: String(error).slice(0, 200) };
    }
    await forgetOwnedTab(key, tabId);
    return { closed: true, alreadyGone: true };
  }
}

/**
 * Roda uma função no mundo MAIN da aba — é onde o `ytInitialData` vive, fora do
 * alcance de um script de conteúdo comum. Devolve o resultado ou `null`.
 */
export async function extractInTab(tabId, func, args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args,
  });
  return results[0] ? results[0].result : null;
}
