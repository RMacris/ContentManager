/**
 * Extração das inscrições do YouTube — a lista inteira, com as continuações.
 *
 * ATENÇÃO, REGRA DESTE ARQUIVO: a função é **serializada** e injetada no mundo
 * MAIN da página, como as do `feed-extract`. Lá dentro não existe escopo de
 * módulo, `import`, nem qualquer variável deste arquivo — a função tem que ser
 * autossuficiente. E é **assíncrona**: ela mesma pede as continuações da lista.
 *
 * A página `/feed/channels` embute no `ytInitialData` só a **primeira leva** de
 * inscrições; o resto o YouTube só entrega por continuação — o mesmo pedido que
 * o scroll da página dispara. Aqui a extensão pede a continuação diretamente,
 * no mundo MAIN, com a sessão e o `ytcfg` da página. Rolar a página não
 * resolveria: o `ytInitialData` é um retrato da carga e não muda com o scroll
 * (medido no ticket 04), e ler o DOM depois não traria o `channelId`, que a
 * ponte exige.
 *
 * A forma de referência de cada canal é o `channelRenderer` (medido num
 * resultado de busca, 11/10/2026): `channelId`, `title`, o handle em
 * `navigationEndpoint.browseEndpoint.canonicalBaseUrl` e a contagem em
 * `videoCountText` — com `subscriberCountText` às vezes carregando o `@handle`.
 *
 * O leitor é **tolerante à forma**: qualquer nó com id de canal e título conta
 * como inscrição; a continuação é reconhecida pelo nome do nó (qualquer chave
 * com "continuation" que carregue um `token` de verdade) e seguida até o fim,
 * com teto de páginas e de tempo. Se o retrato da página não trouxer
 * continuação nenhuma, uma última consulta pelo browseId da página confirma se
 * a lista realmente acabou — ou se só a forma do retrato mudou.
 *
 * @param {number} maxChannels teto de canais — a lista vem inteira, o teto só
 *   protege contra uma página patológica.
 * @param {object|null} data JSON já pronto (teste); na página, `null` faz a
 *   função ler `window.ytInitialData`.
 * @param {object|null} options injeção para teste: `{ fetch, ytcfg }` falsos.
 *   Na página vai `null` — valem o `fetch` e o `ytcfg` reais.
 */
export async function extractSubscriptions(maxChannels, data = null, options = null) {
  const source =
    data && typeof data === 'object'
      ? data
      : typeof window !== 'undefined'
        ? window.ytInitialData
        : null;
  if (!source || typeof source !== 'object') {
    return { ok: false, reason: 'ytInitialData ausente', channels: [], hasMore: false, pages: 0, stopReason: null, diagnostics: null };
  }

  const limit = typeof maxChannels === 'number' && maxChannels > 0 ? maxChannels : 1000;
  const channels = [];
  const seen = Object.create(null);

  /** Tetos da paginação: um pedido pendente não pode segurar a rodada para sempre. */
  const FETCH_TIMEOUT_MS = 12000;
  const TOTAL_BUDGET_MS = 90000;
  const MAX_PAGES = 60;
  /** Tetos do censo: cada tentativa guarda só um resumo pequeno e serializável. */
  const MAX_ATTEMPTS = 3;
  const MAX_VALUE_TOKENS = 30;
  const MAX_RENDERER_KEYS = 10;

  /** O browseId da própria página de inscrições — a checagem de "acabou?". */
  const FE_CHANNELS_BROWSE_ID = 'FEchannels';

  function textOf(node) {
    if (!node || typeof node !== 'object') return '';
    if (typeof node.simpleText === 'string') return node.simpleText;
    if (typeof node.content === 'string') return node.content;
    if (Array.isArray(node.runs)) {
      let out = '';
      for (let i = 0; i < node.runs.length; i++) {
        const run = node.runs[i];
        if (run && typeof run.text === 'string') out += run.text;
      }
      return out;
    }
    return '';
  }

  function dig(node, path) {
    let current = node;
    for (let i = 0; i < path.length; i++) {
      if (!current || typeof current !== 'object') return null;
      current = current[path[i]];
    }
    return typeof current === 'string' && current !== '' ? current : null;
  }

  /** `/@handle` (ou uma URL de comando com `@`) vira `handle`, sem o `@`. */
  function handleOfUrl(url) {
    if (typeof url !== 'string') return null;
    const match = /(?:^|\/)@([^\s/?#]+)/.exec(url);
    return match === null ? null : match[1];
  }

  function handleFrom(node) {
    const fromUrl =
      handleOfUrl(dig(node, ['navigationEndpoint', 'browseEndpoint', 'canonicalBaseUrl'])) ??
      handleOfUrl(dig(node, ['navigationEndpoint', 'commandMetadata', 'webCommandMetadata', 'url']));
    if (fromUrl !== null) return fromUrl;

    // Medido: no renderer de busca o `subscriberCountText` guarda o `@handle`.
    const byText = textOf(node.subscriberCountText);
    const match = /^@([^\s]+)$/.exec(byText);
    return match === null ? null : match[1];
  }

  /** A contagem de inscritos: o texto que se declara como tal, onde ele estiver. */
  function subscribersFrom(node) {
    const candidates = [textOf(node.videoCountText), textOf(node.subscriberCountText)];
    for (let i = 0; i < candidates.length; i++) {
      if (/inscrito|subscriber/i.test(candidates[i])) return candidates[i];
    }
    return null;
  }

  /** O maior avatar disponível — a lista os mostra em miniatura de 24–32 px. */
  function avatarFrom(node) {
    if (!node.thumbnail || !Array.isArray(node.thumbnail.thumbnails)) return null;
    const thumbnails = node.thumbnail.thumbnails;
    const last = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1] : null;
    if (!last || typeof last.url !== 'string' || last.url === '') return null;
    return last.url.startsWith('//') ? `https:${last.url}` : last.url;
  }

  /** O nó é uma inscrição? Exige id de canal e título — o resto é tolerante. */
  function channelEntry(node) {
    let id = null;
    if (typeof node.channelId === 'string' && /^UC[\w-]{22}$/.test(node.channelId)) id = node.channelId;
    else if (typeof node.contentId === 'string' && /^UC[\w-]{22}$/.test(node.contentId)) id = node.contentId;
    if (id === null) return null;

    const title = textOf(node.title);
    if (title === '') return null;

    return {
      channelId: id,
      handle: handleFrom(node),
      title,
      avatarUrl: avatarFrom(node),
      subscribersText: subscribersFrom(node),
    };
  }

  /* ---------------------------------------------- canais e continuações */

  /**
   * Um `token` de continuação dentro de um nó. A forma conhecida é
   * `continuationEndpoint.continuationCommand` (ou o próprio
   * `continuationCommand`); a busca genérica cobre renomeações — um `token`
   * string até 4 níveis abaixo de uma chave "continuation…".
   */
  function tokenFrom(value) {
    if (!value || typeof value !== 'object') return null;

    const known = [
      value.continuationEndpoint && value.continuationEndpoint.continuationCommand,
      value.continuationCommand,
    ];
    for (let i = 0; i < known.length; i++) {
      const command = known[i];
      if (command && typeof command === 'object' && typeof command.token === 'string' && command.token.length > 0) {
        return { token: command.token, request: typeof command.request === 'string' ? command.request : null };
      }
    }

    const queue = [{ node: value, depth: 0 }];
    while (queue.length > 0) {
      const item = queue.shift();
      if (item.depth >= 4) continue;
      const keys = Object.keys(item.node);
      for (let i = 0; i < keys.length; i++) {
        const child = item.node[keys[i]];
        if (keys[i] === 'token' && typeof child === 'string' && child.length > 16) {
          return { token: child, request: null };
        }
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          queue.push({ node: child, depth: item.depth + 1 });
        }
      }
    }
    return null;
  }

  /**
   * Varre um JSON (o retrato da página ou uma resposta de continuação). Os
   * canais entram em `channels`, com dedupe por id e o teto; devolve `next`, a
   * continuação **mais próxima dos canais** — token de outra seção (guia ou
   * chips de ordenação) fica de fora quando há canal para comparar — e `diag`,
   * o censo estrutural do que foi visto: onde mora o primeiro canal, toda chave
   * com "continuation", "token", "nextPage" ou "morePages" no caminho e toda
   * string com a cara de token de continuação (`4qmF…`), mesmo sob uma chave de
   * nome qualquer. É o que denuncia uma forma nova da página em vez de deixar o
   * leitor jurar fim.
   *
   * As candidatas achadas **pelo valor** são só diagnóstico: elas recebem a
   * mesma pontuação do seletor e a marca de quem teria vencido, mas a lista que
   * escolhe `next` continua sendo apenas a das candidatas por nome — a seleção
   * desta rodada não muda.
   */
  function scan(root, label) {
    const tokens = [];
    const stacks = [];
    /** Candidatas por valor: `{ token, request, stack }` — nunca alimentam `next`. */
    const valueCandidates = [];
    const diag = {
      label,
      top: root !== null && typeof root === 'object' ? Object.keys(root).slice(0, 16) : [],
      channelsSeen: 0,
      firstChannelPath: null,
      continuationKeys: [],
      tokenKeys: [],
      valueTokens: [],
      rendererKeys: [],
    };

    /** Os tokens de continuação do YouTube começam todos por `4qmF`; a chave que os guarda, não. */
    const CONTINUATION_TOKEN_VALUE = /^4qmF[A-Za-z0-9_-]{16,}$/;

    /**
     * Guarda uma string com cara de token de continuação. O caminho é o do
     * valor (`…gridRenderer.params`), que é o que denuncia o token escondido; a
     * candidata fica numa lista à parte, para a pontuação do seletor.
     */
    function recordValueToken(value) {
      if (diag.valueTokens.length >= MAX_VALUE_TOKENS) return;
      const entry = {
        p: trail.join(''),
        len: value.length,
        t: value.slice(0, 32),
      };
      diag.valueTokens.push(entry);
      valueCandidates.push({ token: value, request: null, stack: stack.slice(), entry });
    }

    function recordContinuationKey(key, value, node) {
      if (diag.continuationKeys.length < 30) {
        diag.continuationKeys.push({
          k: key,
          p: trail.join('') + '.' + key,
          c: value !== null && typeof value === 'object' ? Object.keys(value).slice(0, 8).join(',') : typeof value,
        });
      }
      const found = tokenFrom(node[key]);
      if (found !== null) tokens.push({ token: found.token, request: found.request, stack: stack.slice() });
    }

    function recordTokenKey(key, value) {
      if (diag.tokenKeys.length >= 30) return;
      let shape;
      if (value === null || value === undefined) shape = String(value);
      else if (typeof value === 'object') shape = '{' + Object.keys(value).slice(0, 6).join(',') + '}';
      else shape = typeof value === 'string' ? 'str(' + value.length + ') ' + value.slice(0, 48) : String(value);
      diag.tokenKeys.push({ k: key, p: trail.join('') + '.' + key, t: shape });
    }

    let stack = [];
    let trail = [];

    function walk(node) {
      // O token pode estar em qualquer string — valor de objeto ou item de
      // array. O caminho que vale é o do valor, não o do nome da chave.
      if (typeof node === 'string') {
        if (CONTINUATION_TOKEN_VALUE.test(node)) recordValueToken(node);
        return;
      }
      if (node === null || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        stack.push(node);
        for (let i = 0; i < node.length; i++) {
          trail.push('[' + i + ']');
          walk(node[i]);
          trail.pop();
        }
        stack.pop();
        return;
      }

      const keys = Object.keys(node);

      // A forma da resposta: nomes de renderer/view model vistos, sem repetir.
      for (let i = 0; i < keys.length && diag.rendererKeys.length < MAX_RENDERER_KEYS; i++) {
        const name = keys[i];
        if (/(Renderer|ViewModel)$/.test(name) && diag.rendererKeys.indexOf(name) < 0) {
          diag.rendererKeys.push(name);
        }
      }

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const lower = key.toLowerCase();
        const isCont = lower.indexOf('continuation') >= 0;
        const isTok = lower.indexOf('token') >= 0 || lower.indexOf('nextpage') >= 0 || lower.indexOf('morepages') >= 0;
        if (!isCont && !isTok) continue;

        const value = node[key];
        if (isCont) recordContinuationKey(key, value, node);
        if (isTok) recordTokenKey(key, value);
      }

      const channel = channelEntry(node);
      if (channel !== null) {
        stacks.push(stack.slice());
        diag.channelsSeen += 1;
        if (diag.firstChannelPath === null) diag.firstChannelPath = trail.join('');
        if (seen[channel.channelId] !== true) {
          seen[channel.channelId] = true;
          if (channels.length < limit) channels.push(channel);
        }
        return; // não descer dentro de um canal já reconhecido
      }

      for (let i = 0; i < keys.length; i++) {
        trail.push('.' + keys[i]);
        walk(node[keys[i]]);
        trail.pop();
      }
    }

    walk(root);
    stack = null;
    trail = null;

    /** A distância entre a pilha do token e o ancestral que ele divide com o canal mais próximo. */
    function distanceScore(tokenStack) {
      if (stacks.length === 0) return 0;
      let score = null;
      for (let j = 0; j < stacks.length; j++) {
        const stackOfChannel = stacks[j];
        let common = 0;
        const max = Math.min(tokenStack.length, stackOfChannel.length);
        while (common < max && tokenStack[common] === stackOfChannel[common]) common += 1;
        if (common === 0) continue;
        const candidate = tokenStack.length - common;
        if (score === null || candidate < score) score = candidate;
      }
      return score;
    }

    // A pontuação é a distância entre o token e o ancestral mais próximo que
    // ele tem em comum com um canal: 0 é "está no mesmo bloco". Sem canal
    // nenhum na varredura, vale o primeiro token. A escolha continua sendo só
    // entre as candidatas por nome — o censo v2 não mexe nesta fila.
    let next = null;
    let best = null;
    let bestScore = Infinity;
    if (tokens.length > 0) {
      for (let i = 0; i < tokens.length; i++) {
        const info = tokens[i];
        const score = distanceScore(info.stack);
        if (score === null) continue;
        if (score < bestScore) {
          bestScore = score;
          best = info;
        }
      }
      if (best === null) best = tokens[0];
      next = { token: best.token, request: best.request };
    }

    // O censo das candidatas achadas pelo valor: a conta do seletor, mas sem
    // entrar na escolha. `wouldWin` responde se a candidata teria vencido o
    // token seguido — é a pergunta que a próxima rodada logada precisa responder.
    let valueWinner = null;
    let winningScore = bestScore;
    if (tokens.length === 0) {
      let valueBest = null;
      let valueBestScore = Infinity;
      for (let i = 0; i < valueCandidates.length; i++) {
        const info = valueCandidates[i];
        const score = distanceScore(info.stack);
        info.entry.score = score;
        if (score !== null && score < valueBestScore) {
          valueBestScore = score;
          valueBest = info;
        }
      }
      // Sem nenhuma pontuada, o seletor cai na primeira da fila — o mesmo
      // desempate que valeria se as candidatas por valor entrassem na lista.
      valueWinner = valueBest !== null ? valueBest : valueCandidates.length > 0 ? valueCandidates[0] : null;
    } else {
      for (let i = 0; i < valueCandidates.length; i++) {
        const info = valueCandidates[i];
        const score = distanceScore(info.stack);
        info.entry.score = score;
        if (score !== null && score < winningScore) {
          winningScore = score;
          valueWinner = info;
        }
      }
    }
    for (let i = 0; i < valueCandidates.length; i++) {
      valueCandidates[i].entry.wouldWin = valueCandidates[i] === valueWinner;
    }

    return { next, found: stacks.length, diag };
  }

  /* ----------------------------------------------------------- paginação */

  const fetchImpl =
    options && typeof options.fetch === 'function'
      ? options.fetch
      : typeof fetch === 'function'
        ? fetch
        : null;
  const cfg = options && options.ytcfg ? options.ytcfg : typeof window !== 'undefined' ? window.ytcfg : null;

  function cfgGet(key) {
    if (cfg === null || cfg === undefined) return null;
    try {
      if (typeof cfg.get === 'function') return cfg.get(key);
      return typeof cfg[key] === 'string' ? cfg[key] : null;
    } catch (error) {
      return null;
    }
  }

  const apiKeyValue = cfgGet('INNERTUBE_API_KEY');
  const apiKey = typeof apiKeyValue === 'string' && apiKeyValue !== '' ? apiKeyValue : null;
  const contextValue = cfgGet('INNERTUBE_CONTEXT');
  const context =
    contextValue && typeof contextValue === 'object'
      ? contextValue
      : { client: { clientName: 'WEB', clientVersion: '2.0' } };
  const clientVersion = dig(context, ['client', 'clientVersion']) ?? '2.0';
  const visitorData = dig(context, ['client', 'visitorData']);

  /** POST no endpoint da continuação, com a sessão da página (os cookies vão juntos). */
  async function post(body, request) {
    if (fetchImpl === null || apiKey === null) return { ok: false, reason: 'missing-config' };

    const endpoint = request === 'CONTINUATION_REQUEST_TYPE_SEARCH' ? '/search' : '/browse';
    const url =
      'https://www.youtube.com/youtubei/v1' + endpoint + '?key=' + encodeURIComponent(apiKey) + '&prettyPrint=false';
    const headers = {
      'content-type': 'application/json',
      'x-youtube-client-name': '1',
      'x-youtube-client-version': clientVersion,
    };
    if (visitorData !== null) headers['x-goog-visitor-id'] = visitorData;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller !== null ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
        ...(controller !== null ? { signal: controller.signal } : {}),
      });
      if (!response || response.ok !== true) return { ok: false, reason: 'fetch-failed', status: response ? response.status : null };
      return {
        ok: true,
        body: await response.json(),
        status: typeof response.status === 'number' ? response.status : null,
      };
    } catch (error) {
      return { ok: false, reason: 'fetch-failed' };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  const canFetch = fetchImpl !== null && apiKey !== null;
  const visited = Object.create(null);
  const budgetUntil = Date.now() + TOTAL_BUDGET_MS;
  let pages = 0;
  let hasMore = false;
  let stopReason = null;

  /** O censo das varreduras — é o que denuncia a forma da página num próximo passo. */
  const diagnostics = { snapshot: null, bootstrap: null, pages: [], attempts: [] };

  /** Os 12 primeiros nomes do topo da resposta — a forma bruta que voltou. */
  function topKeysOf(body) {
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).slice(0, 12) : [];
  }

  function hasKey(body, key) {
    return body !== null && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, key);
  }

  /**
   * O censo de cada tentativa: o token que foi seguido e a forma exata do que
   * ele devolveu, lado a lado. Sem isto, "token errado" e "resposta em forma
   * nova" ficam indistinguíveis no storage.
   */
  function attemptOf(nextToken, response) {
    return {
      tokenPrefix: nextToken.token.slice(0, 32),
      tokenLength: nextToken.token.length,
      request: nextToken.request ?? null,
      status: typeof response.status === 'number' ? response.status : null,
      top: [],
      channelsSeen: 0,
      hasActions: false,
      hasEndpoints: false,
      hasContinuationContents: false,
      rendererKeys: [],
    };
  }

  /** Segue as continuações até acabarem, um teto bater ou um pedido falhar. */
  async function follow(startNext) {
    let next = startNext;
    // Se nenhuma página da corrente produzir canal, o token não valia nada — a
    // corrente está morta, e "acabou" seria mentira.
    let chainFound = 0;
    while (next !== null) {
      if (channels.length >= limit) {
        hasMore = true;
        stopReason = 'cap';
        return;
      }
      if (pages >= MAX_PAGES) {
        hasMore = true;
        stopReason = 'page-limit';
        return;
      }
      if (Date.now() > budgetUntil) {
        hasMore = true;
        stopReason = 'time-budget';
        return;
      }
      if (visited[next.token] === true) {
        hasMore = true;
        stopReason = 'loop';
        return;
      }
      visited[next.token] = true;

      const response = await post({ context, continuation: next.token }, next.request);
      pages += 1;
      const attempt = attemptOf(next, response);
      if (diagnostics.attempts.length < MAX_ATTEMPTS) diagnostics.attempts.push(attempt);
      if (response.ok !== true) {
        if (response.status === 400) {
          // O YouTube recusa o token final quando a coleção acaba — medido: a
          // última continuação de uma busca devolve 400 de forma persistente.
          // É o fim da linha, não uma falha que deixe a lista parcial.
          stopReason = 'complete';
          return;
        }
        hasMore = true;
        stopReason = 'fetch-failed';
        return;
      }
      const page = scan(response.body, 'pagina');
      attempt.top = topKeysOf(response.body);
      attempt.channelsSeen = page.diag.channelsSeen;
      attempt.hasActions = hasKey(response.body, 'onResponseReceivedActions');
      attempt.hasEndpoints = hasKey(response.body, 'onResponseReceivedEndpoints');
      attempt.hasContinuationContents = hasKey(response.body, 'continuationContents');
      attempt.rendererKeys = page.diag.rendererKeys.slice(0, MAX_RENDERER_KEYS);
      if (diagnostics.pages.length < 3) diagnostics.pages.push(page.diag);
      chainFound += page.found;
      next = page.next;
    }
    if (chainFound === 0) {
      hasMore = true;
      stopReason = 'stale-continuation';
      return;
    }
    stopReason = 'complete';
  }

  const first = scan(source, 'retrato');
  diagnostics.snapshot = first.diag;

  if (first.next !== null) {
    if (!canFetch) {
      hasMore = true;
      stopReason = 'missing-config';
    } else {
      await follow(first.next);
    }
  } else if (!canFetch) {
    stopReason = 'no-continuation';
  } else {
    // Retrato sem continuação nenhuma: pergunta ao YouTube a mesma grade pelo
    // browseId da página. Se vier token, a lista continua; se não vier, acabou
    // — e o que veio de novo entra pelo mesmo leitor tolerante.
    const response = await post({ context, browseId: FE_CHANNELS_BROWSE_ID }, null);
    pages += 1;
    if (response.ok !== true) {
      hasMore = true;
      stopReason = 'bootstrap-failed';
    } else {
      const page = scan(response.body, 'fecho');
      diagnostics.bootstrap = page.diag;
      if (page.next === null && page.found === 0) {
        // Nem canal nem continuação na resposta: é uma forma que o leitor não
        // conhece — não podemos jurar que a lista acabou.
        hasMore = true;
        stopReason = 'bootstrap-unrecognized';
      } else if (page.next === null) {
        stopReason = 'complete';
      } else {
        await follow(page.next);
      }
    }
  }

  return { ok: true, reason: null, channels, hasMore, pages, stopReason, diagnostics };
}
