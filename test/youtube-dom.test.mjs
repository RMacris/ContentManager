/**
 * O leitor de DOM do YouTube, com uma fixture só para as cinco formas que o
 * layout real apresenta: card clássico, lockup, anúncio, Shorts e página de
 * canal. O teste não exercita o filtro nem o chip; confere o modelo que os
 * dois consomem.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  channelPage,
  classicVideoCard,
  createFakeDocument,
  element,
  lockupCard,
  promotedAdSlot,
  promotedVideoCard,
  shortsLinkCard,
  shortsLockup,
  watchOwner,
} from './fixtures/youtube-dom.fixtures.mjs';

const keywordCore = readFileSync(new URL('../src/content/keyword-core.js', import.meta.url), 'utf8');
const channelRules = readFileSync(new URL('../src/content/channel-rules.js', import.meta.url), 'utf8');
const youtubeDom = readFileSync(new URL('../src/content/youtube-dom.js', import.meta.url), 'utf8');

function createReader() {
  const sandbox = {
    document: createFakeDocument(),
    NodeFilter: { SHOW_TEXT: 4 },
  };
  runInNewContext(`${keywordCore}\n${channelRules}\n${youtubeDom}`, sandbox, {
    filename: 'youtube-dom.js',
  });
  return sandbox.YTIYouTubeDom;
}

test('the card selector covers every recommendation surface, including video pages', () => {
  const dom = createReader();
  const selector = dom.selectors.card;
  const surfaces = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-compact-autoplay-renderer',
    'ytd-compact-playlist-renderer',
    'ytd-compact-radio-renderer',
    'ytd-playlist-renderer',
    'ytd-radio-renderer',
    'ytd-reel-item-renderer',
    'ytd-rich-grid-slim-media',
    'ytm-shorts-lockup-view-model',
    'ytd-shorts-lockup-view-model',
    'yt-lockup-view-model',
    '.ytp-ce-element',
    '.ytp-autonav-endscreen-upnext-container',
  ];
  for (const surface of surfaces) {
    assert.ok(selector.includes(surface), `${surface} is part of the scanned recommendation surfaces`);
  }
});

test('watch page recommendation cards read title, channel and age like the feed cards', () => {
  const dom = createReader();
  const autoplay = classicVideoCard({
    tagName: 'ytd-compact-autoplay-renderer',
    title: 'A seguir',
    channel: 'Retro Pulse',
    handle: '@retro',
    age: 'há 2 dias',
  });
  const read = dom.readCard(autoplay);
  assert.equal(read.title, 'A seguir');
  assert.equal(read.channels[0].name, 'Retro Pulse');
  assert.equal(read.channels[0].handle, 'retro');
  assert.ok(read.metadataTexts.includes('há 2 dias'), 'the autoplay card age is read like any other card');

  const endScreen = classicVideoCard({
    tagName: 'div',
    className: 'ytp-ce-element',
    title: 'Sugestão final',
    channel: 'Outro Canal',
    handle: '@outro',
  });
  const endRead = dom.readCard(endScreen);
  assert.equal(endRead.title, 'Sugestão final');
  assert.equal(endRead.channels[0].handle, 'outro');
});

test('a classic card exposes title, channel, metadata and the card target', () => {
  const dom = createReader();
  const card = classicVideoCard();
  const read = dom.readCard(card);

  assert.equal(read.promoted, false);
  assert.equal(read.shorts, false);
  assert.equal(read.video, true);
  assert.equal(read.title, 'Vídeo antigo');
  assert.equal(read.channels.length, 1);
  assert.equal(read.channels[0].name, 'Rick Astley');
  assert.equal(read.channels[0].handle, 'RickAstley');
  assert.ok(read.metadataTexts.includes('há 6 dias'), 'the age text is part of the read model');
  assert.ok(read.wholeText.includes('Vídeo antigo'), 'the whole-card text remains available as fallback');

  const container = card.querySelector('ytd-channel-name');
  const target = dom.readChannelTarget(container, { kind: 'classic' });
  assert.equal(target.name, 'Rick Astley');
  assert.equal(target.handle, 'RickAstley');
  assert.equal(target.surface, 'card', 'a channel inside a card gets the compact chip');
  assert.equal(target.key, container);
  assert.equal(target.parent, container);
  assert.equal(target.after, null, 'the classic chip is appended to the channel name');
});

test('a classic channel name on the watch page is a watch surface', () => {
  const dom = createReader();
  const owner = watchOwner();
  const container = owner.querySelector('ytd-channel-name');
  const target = dom.readChannelTarget(container, { kind: 'classic' });

  assert.equal(target.name, 'Rick Astley');
  assert.equal(target.handle, 'RickAstleyYT');
  assert.equal(target.surface, 'watch');
  assert.equal(target.parent, container);
});

test('the chip card surface also covers playlist cards the filter never judges', () => {
  const dom = createReader();
  const playlist = element('ytd-playlist-video-renderer');
  playlist.append(watchOwner().querySelector('ytd-channel-name'));

  const target = dom.readChannelTarget(playlist.querySelector('ytd-channel-name'), { kind: 'classic' });
  assert.equal(target.surface, 'card', 'a playlist item gets the compact chip like before');
});

test('a lockup reads its title and places the chip after the channel name row', () => {
  const dom = createReader();
  const lockup = lockupCard();
  const read = dom.readCard(lockup);

  assert.equal(read.promoted, false);
  assert.equal(read.shorts, false);
  assert.equal(read.video, true);
  assert.equal(read.title, 'Retro video');

  const row = lockup.querySelector('.ytContentMetadataViewModelMetadataRow');
  const nameNode = row.querySelector('.ytContentMetadataViewModelMetadataText');
  const target = dom.readChannelTarget(lockup, { kind: 'lockup' });
  assert.equal(target.name, 'Retro Pulse');
  assert.equal(target.handle, '');
  assert.equal(target.surface, 'card');
  assert.equal(target.key, row);
  assert.equal(target.parent, row);
  assert.equal(target.after, nameNode, 'the chip goes after the name, before the views');
});

test('ads and in-feed ads are promoted and never treated as dated videos', () => {
  const dom = createReader();

  assert.equal(dom.readCard(promotedAdSlot()).promoted, true);
  assert.equal(dom.readCard(promotedVideoCard()).promoted, true);
});

test('Shorts lockups and cards with a Shorts link are recognized', () => {
  const dom = createReader();

  assert.equal(dom.readCard(shortsLockup()).shorts, true);
  assert.equal(dom.readCard(shortsLinkCard()).shorts, true);
});

test('the channel page reads its header target and its subscriptions card', () => {
  const dom = createReader();
  const page = channelPage();

  const header = dom.readChannelTarget(page.title, { kind: 'page', pathname: '/@RickAstleyYT' });
  assert.equal(header.name, 'Rick Astley');
  assert.equal(header.handle, 'RickAstleyYT');
  assert.equal(header.surface, 'watch');
  assert.equal(header.key, page.title);
  assert.equal(header.parent, page.title);
  assert.equal(
    dom.readChannelTarget(page.title, { kind: 'page', pathname: '/watch' }),
    null,
    'a page title outside a channel path is ignored',
  );

  const subscribed = dom.readSubscribedChannel(page.subscription);
  assert.equal(subscribed.name, 'Rick Astley');
  assert.equal(subscribed.handle, '@RickAstleyYT');
  assert.equal(subscribed.avatarUrl, 'https://yt3.example/rick.jpg');
});

test('the subscriptions card falls back to the main link when the label is not a handle', () => {
  const dom = createReader();
  const page = channelPage({ subscribers: '1,2 mi de inscritos' });

  assert.equal(dom.readSubscribedChannel(page.subscription).handle, '@RickAstleyYT');
});
