/**
 * Cards e páginas do YouTube em memória para a suíte do leitor de DOM.
 *
 * O leitor é o único módulo que interpreta o layout; por isso as fixtures
 * descrevem as cinco formas que ele precisa reconhecer — card clássico,
 * lockup, anúncio, Shorts e página de canal — uma vez só. O mini seletor
 * abaixo cobre apenas as formas usadas nos seletores reais: tag, id, classe,
 * atributo (presença, prefixo e conteúdo) e descendência simples.
 */

export class FakeText {
  constructor(data) {
    this.nodeType = 3;
    this.data = data;
    this.parentNode = null;
  }
}

export class FakeElement {
  constructor(tagName, options = {}) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.id = options.id || '';
    this.className = options.className || '';
    this.attributes = new Map(Object.entries(options.attrs || {}));
    this.childNodes = [];
    this.children = [];
    this.parentNode = null;
    this.visible = options.visible !== false;
    if (options.text !== undefined) this.append(options.text);
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(typeof node === 'string' ? new FakeText(node) : node);
    return this;
  }

  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    if (node.nodeType !== 3) this.children.push(node);
    return node;
  }

  insertBefore(node, reference) {
    node.parentNode = this;
    const childIndex = this.childNodes.indexOf(reference);
    if (childIndex === -1) this.childNodes.push(node);
    else this.childNodes.splice(childIndex, 0, node);
    if (node.nodeType !== 3) {
      const elementIndex = this.children.indexOf(reference);
      if (elementIndex === -1) this.children.push(node);
      else this.children.splice(elementIndex, 0, node);
    }
    return node;
  }

  removeChild(node) {
    const childIndex = this.childNodes.indexOf(node);
    if (childIndex !== -1) this.childNodes.splice(childIndex, 1);
    const elementIndex = this.children.indexOf(node);
    if (elementIndex !== -1) this.children.splice(elementIndex, 1);
    node.parentNode = null;
    return node;
  }

  remove() {
    if (this.parentNode !== null) this.parentNode.removeChild(this);
  }

  get textContent() {
    return this.childNodes.map((node) => (node.nodeType === 3 ? node.data : node.textContent)).join('');
  }

  set textContent(value) {
    this.childNodes = [];
    this.children = [];
    if (value !== '') this.appendChild(new FakeText(String(value)));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getClientRects() {
    return this.visible ? [{}] : [];
  }

  get nextElementSibling() {
    if (this.parentNode === null) return null;
    const index = this.parentNode.children.indexOf(this);
    return index !== -1 && index + 1 < this.parentNode.children.length
      ? this.parentNode.children[index + 1]
      : null;
  }

  matches(selector) {
    return splitSelectorList(selector).some((part) => matchesComplex(this, part));
  }

  closest(selector) {
    let current = this;
    while (current !== null && current.nodeType === 1) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    const found = this.querySelectorAll(selector);
    return found.length > 0 ? found[0] : null;
  }

  querySelectorAll(selector) {
    const found = [];
    collectMatches(this, selector, found);
    return found;
  }
}

/** O documento mínimo do leitor: a caminhada de texto dos seletores. */
export function createFakeDocument() {
  return {
    createTreeWalker(node) {
      const texts = [];
      collectText(node, texts);
      let index = 0;
      return {
        nextNode() {
          return index < texts.length ? texts[index++] : null;
        },
      };
    },
  };
}

/* ------------------------------------------------------------- as fixtures */

/** Card clássico da home: título, metadados de idade e link do canal. */
export function classicVideoCard({
  title = 'Vídeo antigo',
  channel = 'Rick Astley',
  handle = '@RickAstley',
  age = 'há 6 dias',
  views = '1,2 mi de visualizações',
  link = '/watch?v=classic',
  tagName = 'ytd-rich-item-renderer',
  className = '',
} = {}) {
  const card = element(tagName, { className });
  const content = element('div');

  const titleLink = element('a', { id: 'video-title', attrs: { href: link, title } });
  titleLink.append(title);
  content.append(titleLink);

  const metadata = element('div', { id: 'metadata-line' });
  metadata.append(element('span', { text: views }), element('span', { text: age }));
  content.append(metadata);

  const channelName = element('ytd-channel-name');
  const channelLink = element('a', { attrs: { href: '/' + handle } });
  channelLink.append(channel);
  channelName.append(channelLink);
  content.append(channelName);

  card.append(content);
  return card;
}

/** O dono do vídeo na página de watch: mesmo `ytd-channel-name`, outra superfície. */
export function watchOwner(name = 'Rick Astley', handle = '@RickAstleyYT') {
  const owner = element('ytd-video-owner-renderer');
  const channelName = element('ytd-channel-name');
  const link = element('a', { attrs: { href: '/' + handle } });
  link.append(name);
  channelName.append(link);
  owner.append(channelName);
  return owner;
}

/** Lockup novo: o nome do canal é texto na linha de metadados, sem link. */
export function lockupCard({ channel = 'Retro Pulse', title = 'Retro video', views = '1,2 mi de visualizações' } = {}) {
  const lockup = element('yt-lockup-view-model');

  const titleNode = element('a', {
    className: 'yt-lockup-metadata-view-model__heading',
    attrs: { href: '/watch?v=lockup' },
  });
  titleNode.append(title);
  lockup.append(titleNode);

  const metadata = element('yt-content-metadata-view-model');
  const row = element('div', { className: 'ytContentMetadataViewModelMetadataRow' });
  const name = element('span', { className: 'ytContentMetadataViewModelMetadataText', text: channel });
  const viewsNode = element('span', { className: 'ytContentMetadataViewModelMetadataText', text: views });
  const badge = element('span', { className: 'ytIconWrapperHost' });
  row.append(name, viewsNode, badge);
  metadata.append(row);
  lockup.append(metadata);
  return lockup;
}

/** Um slot de anúncio no feed. */
export function promotedAdSlot() {
  const card = element('ytd-ad-slot-renderer');
  card.append(element('div', { className: 'ad-badge-view-model', text: 'Patrocinado' }));
  return card;
}

/** Um card de vídeo com o selo de anúncio dentro. */
export function promotedVideoCard() {
  const card = classicVideoCard({ title: 'Oferta' });
  card.append(element('feed-ad-metadata-view-model', { text: 'Patrocinado' }));
  return card;
}

/** Um Shorts no layout novo. */
export function shortsLockup() {
  const item = element('ytm-shorts-lockup-view-model');
  const link = element('a', { attrs: { href: '/shorts/abc' } });
  link.append('Short de teste');
  item.append(link);
  return item;
}

/** Um card comum que aponta para um Shorts. */
export function shortsLinkCard() {
  const card = classicVideoCard({ title: 'Short de teste', link: '/shorts/abc' });
  return card;
}

/** O cabeçalho da página de canal e um card da página de inscrições. */
export function channelPage({
  name = 'Rick Astley',
  handle = '@RickAstleyYT',
  subscribers = '@RickAstleyYT',
  avatarUrl = 'https://yt3.example/rick.jpg',
} = {}) {
  const header = element('yt-page-header-renderer');
  const title = element('h1', { text: name });
  header.append(title);

  const subscription = element('ytd-channel-renderer');
  const titleWrap = element('div', { id: 'channel-title' });
  titleWrap.append(element('span', { id: 'text', text: name }));
  subscription.append(titleWrap);
  subscription.append(element('a', { id: 'main-link', attrs: { href: '/' + handle } }));
  subscription.append(element('span', { id: 'subscribers', text: subscribers }));
  subscription.append(element('img', { id: 'img', attrs: { src: avatarUrl } }));

  return { header, title, subscription };
}

/* ------------------------------------------------- mini motor de seletores */

export function element(tagName, options = {}, ...children) {
  return new FakeElement(tagName, options).append(...children);
}

function collectText(node, texts) {
  if (node.nodeType === 3) {
    texts.push(node);
    return;
  }
  for (const child of node.childNodes || []) collectText(child, texts);
}

function collectMatches(node, selector, found) {
  for (const child of node.children || []) {
    if (child.matches(selector)) found.push(child);
    collectMatches(child, selector, found);
  }
}

function splitSelectorList(selector) {
  return String(selector)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function matchesComplex(node, selector) {
  const parts = selector.split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0 || !matchesCompound(node, parts[parts.length - 1])) return false;

  let current = node;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    let ancestor = current.parentNode;
    while (ancestor !== null && ancestor.nodeType === 1 && !matchesCompound(ancestor, parts[i])) {
      ancestor = ancestor.parentNode;
    }
    if (ancestor === null || ancestor.nodeType !== 1) return false;
    current = ancestor;
  }
  return true;
}

function matchesCompound(node, compound) {
  if (node === null || node.nodeType !== 1) return false;
  let rest = compound;

  const tag = rest.match(/^([a-zA-Z][\w-]*)/);
  if (tag !== null) {
    if (node.tagName !== tag[1].toUpperCase()) return false;
    rest = rest.slice(tag[0].length);
  }

  const id = rest.match(/#([\w-]+)/);
  if (id !== null && node.id !== id[1]) return false;

  const classes = rest.match(/\.[\w-]+/g) || [];
  for (const className of classes) {
    const name = className.slice(1);
    if (!node.className.split(/\s+/).includes(name)) return false;
  }

  const attributes = rest.match(/\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]/g) || [];
  for (const attribute of attributes) {
    const parts = attribute.match(/\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]/);
    const name = parts[1];
    if (!node.hasAttribute(name)) return false;
    const value = node.getAttribute(name);
    const operator = parts[2];
    const expected = parts[3];
    if (operator === '*=' && !value.includes(expected)) return false;
    else if (operator === '^=' && !value.startsWith(expected)) return false;
    else if (operator === '=' && value !== expected) return false;
  }

  return true;
}
