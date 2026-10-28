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
- **Age filter on youtube.com:** Cards whose age is more than 3 days old are hidden from the page — home, subscriptions, search results, channels and the sidebar. Shorts, history, liked videos, watch later, playlists and the player are never filtered.
- **Games and ads off the feed:** The playables shelf cards and the sponsored cards (in-feed, search and sidebar slots) are hidden too — they carry no age, so they go whole. Both filters are toggled in the popup, on by default.

### How You Can Help

- **Contribute Code:** Add new features, improve existing ones, or help with bug fixes.
- **Submit Ideas:** Share your thoughts on how we can make this extension more effective.
- **Spread the Word:** Let others know about this project so they can also benefit from it.
- **Collaborate:** Work with other developers to create a stronger, more resilient tool against digital distraction.

Let’s build a community-driven solution to break free from the grasp of big tech corporations.

## Filtro de idade nas recomendações

Um content script em `youtube.com` esconde o card de **recomendação** que é mais velho que 3 dias.
A idade é a que o próprio YouTube escreve no card — "há 5 dias", "há 2 sem.", "1 week ago" —, então
o filtro lê o texto renderizado, não uma data absoluta: o que vale é a mesma conta que o usuário vê.
O limite é estrito: **3 dias fica, 4 dias some**.

Vale onde há recomendação: home, inscrições, resultados de busca, página de canal e a coluna lateral
do player. Fica fora do que o usuário escolheu ver: histórico, vídeos curtidos, assistir depois,
biblioteca, playlists e a página do vídeo principal — ali a data costuma ser uma **ação** ("Assistido
há 2 dias") e esconder o item apagaria a própria lista aberta. **Shorts não são tocados**: o
bloqueio de URL que já existia continua sendo o dono desse caminho. Card sem data reconhecível, Mix
(link de playlist), canal, post e transmissão ao vivo ficam visíveis — o filtro falha **aberto**,
nunca esconde o que não entendeu.

**Jogos e anúncios** não têm idade no card: o jogo da prateleira de playables mostra "Jogado 345 mil
vezes" e "Novidade", o anúncio mostra "Patrocinado". Por isso eles têm interruptor próprio e somem
**inteiros**, sem olhar data — o card de playables (`/playables/`) e o anúncio no feed, na busca e
no slot da coluna lateral. São cards de recomendação como os outros; o que os distingue é não haver
publicação para julgar. A **prateleira** que ficar sem nenhum card visível também some, para o
título não ficar solto sobre um vazio — mas só a que teve todos os cards escondidos pelo filtro; a
de Shorts, que nunca é tocada, continua de pé.

Os dois interruptores ficam no popup, ligados por padrão: **"Esconder vídeos com mais de 3 dias"** e
**"Esconder jogos e anúncios do feed"**. A página reage na hora: desligar devolve o que estava
escondido sem recarregar, e os dois são independentes. Nada é apagado ou guardado: o filtro só
aplica `display: none` com uma marca no card, nunca remove nó, nunca fala com a rede e não guarda
nada sobre os vídeos. Como o YouTube é uma SPA, a varredura acompanha nó novo, a navegação
(`yt-navigate-finish`) e uma varredura periódica de 2 s, com piso de 500 ms entre uma e outra.

## Estrutura

```
manifest.json
src/
├── background/            service worker (módulos ES)
│   ├── service-worker.js  ponto de entrada: instalação e mensagens
│   ├── blocking.js        bloqueio de URLs (declarativeNetRequest)
│   └── settings.js        as duas preferências do filtro
├── content/
│   ├── block-guard.js     redireciona URLs bloqueadas (script clássico)
│   ├── age-core.js        lê a idade do card e decide o limite (script clássico, sem DOM)
│   └── age-filter.js      esconde/mostra os cards no site do YouTube
└── popup/                 interface: bloqueio e interruptores do filtro
```

Nenhum módulo fala com a rede: a extensão não tem servidor, não tem token e não tem
configuração de fora. O que ela sabe mora no `chrome.storage` do próprio perfil.

## Configuração

A seção **Filtro do feed** do popup tem duas caixas ligadas por padrão: **"Esconder vídeos com
mais de 3 dias"** (`hideOldVideos`) e **"Esconder jogos e anúncios do feed"** (`hideGamesAndAds`).
As duas moram em `chrome.storage.sync` e o content script escuta a mudança — por isso desligar não
pede recarregar a página, e cada uma vale por si. Uma aba do YouTube já aberta antes de a extensão
ser recarregada só passa a filtrar depois de um refresh.

## Permissões

Apenas duas: `storage` (as listas e as preferências) e `declarativeNetRequest` (o bloqueio de
URLs). A entrada `host_permissions` de `youtube.com` acompanha os content scripts do filtro. As
permissões `webRequest`, `webNavigation`, `activeTab`, `declarativeNetRequestFeedback`, `scripting`
e `alarms` que versões anteriores declaravam **não existem mais** — a coleta e o servidor local
que precisavam delas saíram na 2.0.0.

## Testes

```powershell
npm test
```

O **manifesto** tem a primeira suíte (`test/manifest.test.mjs`): os limites do Chrome nos campos de
texto — a `description` tem teto de **132** caracteres e um a mais faz o navegador recusar o pacote
inteiro, sem aviso na página —, a versão igual à do `package.json` e todo arquivo apontado pelo
manifesto existindo. Foi assim que a 1.10.0 passou a não filtrar nada em silêncio.

A **idade dos cards** tem suíte própria (`test/age-core.test.mjs`): as formas que o YouTube escreve
em pt e en — "há 5 h", "há 2 sem.", "há 1 mês", "há 13 anos", "1 day ago" —, a recusa das datas de
ação ("Assistido há 5 dias" não é publicação), o que não é data ("N mil assistindo"), e o limite
**estrito** de 3 dias: "há 3 dias" fica, "há 4 dias" some. O `age-core.js` não conhece DOM nem
`chrome`, por isso roda num contexto `vm` do Node.

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
