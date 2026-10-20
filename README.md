# Block Unwanted Content: Reclaim Your Time and Freedom

Are you tired of wasting countless hours on mindless, addictive content like YouTube Shorts, TikTok, Instagram Reels, and X.com? Do you feel the frustration of losing precious time to platforms designed to keep you hooked, draining your productivity and imprisoning your mind? This Chrome extension is here to help you break free from the clutches of big tech corporations and their time-sucking algorithms.

## Purpose

This Chrome extension is designed to block unwanted content that distracts you and saps your valuable time while ensuring your privacy and data are respected. **We do not collect any personal data or browsing history.**

**No data is collected in any form!**

By making this project open source, we offer users complete transparency. You can verify the truth of our claims by simply checking the source code.

**Transparency and data privacy are our top priorities.**


 By blocking sites like YouTube Shorts, TikTok, Instagram Reels, and X.com, you can take back control of your browsing experience and focus on what truly matters. These platforms are notorious for creating addictive environments, capturing your attention, and turning minutes into hours without you even realizing it. They are designed to maximize engagement at the cost of your life and mental well-being.

Join us in the fight against the mental prisons created by big tech corporations.

## How to Use

### Blocking a URL

1. **Enter the URL Pattern:**
   - In the text box labeled "Enter URL pattern to block", type the URL pattern that you want to block. For example, to block all pages from a specific website, you can use patterns like `.*youtube.com/shorts.*` or `.*tiktok.*`.

2. **Click "Block URL":**
   - After entering the URL pattern, click the green "Block URL" button. This will add the URL pattern to the list of blocked URLs.

### Managing Blocked URLs

- **Blocked URLs List:**
  - Below the "Block URL" button, you will see a list of all the blocked URLs. Each URL pattern that you have blocked will appear here.

- **Removing a URL:**
  - To remove a URL from the blocked list, click the red "Remove" button next to the URL pattern you want to unblock. This will remove the URL from the list and it will no longer be blocked.

### Default Blocked URLs

Here are some examples of how to use define a URL you might want block. Some of those are well know to steal our time more then we would want, so you can copy and paste from those example below if you want.
 
- `.*youtube.com/shorts.*`
- `.*tiktok.*`
- `.*instagram.com/reel.*`
- `.*threads.net.*`
- `.*x.com.*`

<img src="example_1.png" alt="Enter URL pattern and click Block URL" height="600px">

These default URLs can be enabled or disabled as needed, but cannot be removed from the list. To enable or disable these default blocked URLs, use the toggle button in the extension settings.

## Understanding `.*` in Regular Expressions

When using this extension to block URLs, you'll often see the pattern `.*` used in URL patterns. This is a regular expression (regex) syntax that is very powerful for matching a wide range of text. Here’s what it means:

- **`.` (Dot):** The dot character matches any single character except newline characters. It acts as a wildcard.
- **`*` (Asterisk):** The asterisk character is a quantifier that matches zero or more of the preceding element. In this case, it matches zero or more of any character (because it follows the dot).

### Combining `.` and `*`

When you put them together as `.*`, it means "match any sequence of characters, including none."

### Examples

Here are some examples of how `.*` can be used in URL patterns:

- **`.*youtube.com/shorts.*`**
  - **Meaning:** Match any URL that contains "youtube.com/shorts" anywhere in the URL.
  - **Example URLs Matched:**
    - `https://www.youtube.com/shorts/abcd1234`
    - `http://youtube.com/shorts/some-video`
    - `https://subdomain.youtube.com/shorts/another-video`

- **`.*tiktok.*`**
  - **Meaning:** Match any URL that contains "tiktok" anywhere in the URL.
  - **Example URLs Matched:**
    - `https://www.tiktok.com`
    - `http://m.tiktok.com`
    - `https://tiktok.com/user/someuser`

- **`.*instagram.com/reel.*`**
  - **Meaning:** Match any URL that contains "instagram.com/reel" anywhere in the URL.
  - **Example URLs Matched:**
    - `https://www.instagram.com/reel/abcd1234`
    - `http://instagram.com/reel/some-video`

- **`.*threads.net.*`**
  - **Meaning:** Match any URL that contains "threads.net" anywhere in the URL.
  - **Example URLs Matched:**
    - `https://www.threads.net/some-thread`
    - `http://threads.net/user/someuser`

### Why Use `.*`?

Using `.*` makes your URL blocking pattern very flexible and powerful. It ensures that any variation of the URL that contains the specified string will be matched and blocked. This is useful for sites that might use different subdomains or URL structures.

By understanding and using `.*`, you can effectively block a wide range of URLs with a single pattern.

### Notes

- **URL Pattern Format:**
  - The URL patterns use regular expressions. Make sure to use the correct format to match the URLs you want to block.

- **Refresh the Page:**
  - After blocking or unblocking a URL, you may need to refresh any open tabs for the changes to take effect.

## Features

- **Default Blocked URLs:** Out of the box, this extension blocks time-wasting platforms like YouTube Shorts, TikTok, Instagram Reels, and X.com. These defaults can be toggled on and off as needed.
- **Custom URL Blocking:** Users can add or remove their own list of blocked URLs to tailor the extension to their specific needs.
- **Simple User Interface:** An easy-to-use popup interface allows you to manage blocked URLs and toggle default settings with a single click.
- **Non-Removable Defaults:** Critical distractions are always kept at bay, but can be toggled if absolutely necessary.

### How You Can Help

- **Contribute Code:** Add new features, improve existing ones, or help with bug fixes.
- **Submit Ideas:** Share your thoughts on how we can make this extension more effective.
- **Spread the Word:** Let others know about this project so they can also benefit from it.
- **Collaborate:** Work with other developers to create a stronger, more resilient tool against digital distraction.

Let’s build a community-driven solution to break free from the grasp of big tech corporations.

## Coleta do feed do YouTube

Além do bloqueio, esta extensão colhe o **topo** do feed do YouTube e o envia para uma ponte
local, que filtra o conteúdo com uma LLM rodando na própria máquina. A extensão **não** julga
nada: ela só coleta e entrega.

O que ela envia por card: thumbnail, título, data, nome do canal e avatar — exatamente o que o
card mostra na tela, sem analisar o vídeo.

**Como funciona o ciclo.** Um alarme interno (`chrome.alarms`) acorda a extensão no período
configurado. Ela busca a home do YouTube **do próprio service worker**, com a sessão do usuário
(`credentials: 'include'`), lê o `ytInitialData` do HTML e envia os cards por HTTP para a ponte —
**sem abrir aba**. Nenhuma aba do usuário é selecionada, navegada nem fechada. Uma rodada que
falha agenda uma retentativa curta (5 minutos, no máximo duas) em vez de esperar a hora cheia;
sucesso encerra o episódio, e alarme e botão começam um novo. O que falhou decide o que repetir:
falha de **colheita** repete a rodada; falha de **entrega** apenas esvazia a fila, sem colher de
novo — re-colher empurraria mais um lote para uma fila cheia, expulsando o que ainda não chegou.
Com uma rodada em andamento, alarme e botão compartilham a mesma colheita em vez de buscar duas
vezes.

**Por que a extensão inicia, e não o contrário.** O service worker do MV3 dorme quando ocioso, e
nada fora da extensão consegue acordá-lo. Por isso a coleta roda no relógio dela. O efeito
colateral é bom: nenhum agente consegue mandar esta extensão fazer nada.

**Por que lê o JSON e não o DOM.** Medido: no DOM, a maior parte das thumbnails fora da tela e
praticamente todos os avatares vêm vazios por lazy loading, enquanto o payload da página tem
todos. Como a leitura é do JSON embutido no HTML (`ytInitialData`), ela não depende do mundo MAIN
nem de a página ter renderizado — é o que permite a rota sem aba. O `PAGE_BUILD_LABEL` também vem
do HTML, para a colheita continuar carimbada com a build do YouTube que a gerou.

**Colher inscrições (manual).** O popup também tem o botão **"Colher inscrições"**: abre
`youtube.com/feed/channels` numa aba própria **em segundo plano**, lê o `ytInitialData` no mundo
MAIN (mesmo caminho JSON-first do feed), entrega por `POST /subscriptions` e fecha a aba —
sucesso ou falha. A ponte grava o retrato em `state/subscriptions.json`, e é essa lista que o
painel do harness usa para sugerir `@handles` ao editar os canais de confiança. Lista vazia é
falha declarada (quase sempre é login/consentimento), nunca um vazio por cima de uma lista boa.

A página só embute a **primeira leva** de inscrições no JSON; o resto chega por continuação — o
mesmo pedido que o scroll da página dispara. A extensão pede a continuação diretamente (mundo
MAIN, com a sessão e o `ytcfg` da página) e segue até o fim, com teto de canais, de páginas e de
tempo. Se o retrato não trouxer continuação nenhuma, uma consulta final pelo `browseId` da página
confirma se a lista acabou. A extração é tolerante à forma (a referência do `channelRenderer` foi
medida num resultado de busca) e o popup só avisa "lista parcial" quando a coleta **parou antes do
fim** — com o motivo em português e quantas continuações seguiu. Três situações não juram fim: a
consulta de fecho que falha, a que devolve uma resposta sem grade reconhecível, e a continuação
que não produz canal nenhum — corrente morta é forma desconhecida, não lista completa.

O censo estrutural de cada varredura (onde mora o primeiro canal, e toda chave com
`continuation`/`token`/`nextPage` no caminho) fica gravado em `chrome.storage.local` sob
`lastSubscriptionsDiagnostics`, com a versão da extensão — é assim que a forma logada da página
pode ser medida sem navegador, e é onde a próxima divergência de forma se denuncia sozinha.

### Estrutura

```
manifest.json
src/
├── background/          service worker (módulos ES)
│   ├── service-worker.js  ponto de entrada: alarme e mensagens
│   ├── blocking.js        bloqueio de URLs (declarativeNetRequest)
│   ├── settings.js        preferências, token e agendamento do alarme
│   ├── owned-tab.js       a aba própria das inscrições (abrir/esperar/extrair/fechar)
│   ├── feed-fetch.js      a colheita do feed: fetch da home e extração, sem aba
│   ├── collector.js       orquestra a colheita
│   ├── subscriptions.js   orquestra a coleta das inscrições (manual, pelo popup)
│   └── bridge-client.js   entrega por HTTP e fila de pendentes
├── content/
│   └── block-guard.js     redireciona URLs bloqueadas (script clássico)
├── injected/
│   ├── feed-extract.js    lê os cards do `ytInitialData` (worker e página)
│   └── subscriptions-extract.js  lê as inscrições no mundo MAIN da página
└── popup/                 interface: bloqueio e configuração da coleta
```

### Configuração

No popup: ligar/desligar a coleta, o período em minutos, a URL da ponte e o token. O token é
gerado pela ponte em `state/token.txt`, na pasta dela — ele fica em `chrome.storage.local`, não
em `sync`, porque um segredo local não deve viajar entre máquinas. O painel do popup mostra a
última rodada com o gatilho — **automática**, **manual** ou **retentativa** —, o que deixa
visível que a coleta periódica está andando mesmo sem clique.

A entrega tem duas superfícies próprias: o **selo da ação** mostra quantos lotes esperam pela
ponte (vazio em zero) e fica vermelho quando a última entrega falhou; o botão **Enviar pendentes
agora** esvazia a fila **sem colher**, para quando a ponte volta. As chamadas à ponte têm prazo de
5 s e o popup mostra o motivo em português — "sem conexão com a ponte", "token recusado", "a
ponte não respondeu em 5 s" — nunca o `TypeError: Failed to fetch` cru.

A seção **Inscrições** tem linha de status própria: quantos canais a ponte **confirmou ter
guardado** — a contagem que o painel desenha, tirada do dado, não o número que a extração
declarou —, quando, e o motivo quando falhou.

### Permissões

Apenas quatro: `storage`, `declarativeNetRequest`, `scripting` e `alarms`. As permissões
`webRequest`, `webNavigation`, `activeTab` e `declarativeNetRequestFeedback` que a versão anterior
declarava **não eram usadas em lugar nenhum** do código e foram removidas.

### Testes

```powershell
npm test
```

Exercita o extrator contra um payload com o formato real capturado ao vivo — incluindo anúncio,
Shorts, playlist, card sem avatar e o formato antigo —, a **rota sem aba** (fixture de HTML com
`ytInitialData` e `PAGE_BUILD_LABEL`, marcador ausente, zero cards, HTTP não-ok, fetch rejeitado)
e a orquestração da colheita (retentativa agendada, com teto e encerrada por sucesso; chamadas
concorrentes colhem uma vez só) com dublês de `chrome` e um `fetch` que despacha por URL.

A entrega tem suíte própria (`test/bridge-client.test.mjs`): teto da fila e descarte do lote mais
velho, ordem de envio, parada no primeiro erro, timeout que aborta a chamada, e a classificação
de 401, 400, rede e token ausente — cada uma com a frase em português que o popup mostra.

A coleta das inscrições tem as próprias suítes: a **extração** contra um `channelRenderer` real
(handle, avatar, contagem de inscritos, dedupe e ruído da página) e a **paginação** com `fetch` e
`ytcfg` dublês — a continuação seguida até o fim (forma clássica e a renomeada), o token de outra
seção ignorado, o teto cortando sem gastar pedido, a falha de rede declarando parcial, o `400` do
token final fechando a lista, e as três correntes que **não** juram fim (fecho falho, fecho sem
grade reconhecível e continuação morta), mais o censo estrutural que sai em `diagnostics`; e a
**coreografia** da aba própria (segundo plano, fechada ao fim, entrega com token, lista vazia e
falha sem aba órfã, rodada reaproveitada depois de uma morte do worker, censo gravado no storage).

## Installation

1. Clone the repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable "Developer mode" at the top right corner.
4. Click "Load unpacked" and select the cloned directory.

## Contribution Guidelines

We welcome contributions from everyone. Please check out our [contribution guidelines](CONTRIBUTING.md) for more details on how to get started.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
