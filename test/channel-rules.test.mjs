import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const keywordCore = readFileSync(new URL('../src/content/keyword-core.js', import.meta.url), 'utf8');
const channelRules = readFileSync(new URL('../src/content/channel-rules.js', import.meta.url), 'utf8');

const sandbox = {};
runInNewContext(`${keywordCore}\n${channelRules}`, sandbox, { filename: 'channel-rules.js' });
const rules = sandbox.YTIChannelRules;

/** As listas nascem no contexto do `vm`; traga-as para o contexto do teste. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('channel names and handles share one normalized identity', () => {
  assert.equal(rules.normalizeChannelName('  GPT-4 '), 'gpt 4');
  assert.equal(rules.normalizeChannelName('Cozinha da Vovó'), 'cozinha da vovo');
  assert.equal(rules.normalizeHandle(' @TechBR '), 'techbr');
  assert.equal(rules.handleFromHref('/@RickAstley'), 'RickAstley');
  assert.equal(rules.handleFromHref('https://www.youtube.com/@Rick%20Astley?x=1'), 'Rick Astley');
  assert.equal(rules.handleFromHref('/channel/UC123'), '');
  assert.equal(rules.handleFromHref(null), '');
});

test('list normalization drops blanks and repeats by the matcher rule', () => {
  assert.deepEqual(plain(rules.normalizeList(['  GPT-4 ', 'gpt 4', 'Claude', '', 3])), ['GPT-4', 'Claude']);
  assert.equal(rules.hasListItem(['GPT-4'], 'gpt 4'), true);
  assert.equal(rules.hasListItem(['GPT-4'], 'GPT-4o'), false);
  assert.equal(rules.hasListItem(null, 'GPT-4'), false);
});

test('the allowlist matches by handle or by exact normalized name', () => {
  const allowed = rules.normalizeAllowed([
    { name: 'Tech Brasil', handle: '@TechBR' },
    { name: 'tech brasil', handle: '@techbr' },
    { name: 'Cozinha da Vovó', handle: '' },
    null,
  ]);

  assert.deepEqual(plain(allowed), [
    { name: 'Tech Brasil', handle: '@TechBR' },
    { name: 'Cozinha da Vovó', handle: '' },
  ]);
  assert.equal(rules.isAllowedChannel('Tech Brasil', '', allowed), true);
  assert.equal(rules.isAllowedChannel('Outro Nome', 'techbr', allowed), true);
  assert.equal(rules.isAllowedChannel('Cozinha da Vovo', '', allowed), true);
  assert.equal(rules.isAllowedChannel('Outra Cozinha', '', allowed), false);
  assert.equal(rules.isAllowedChannel('Tech Brasil', '', []), false);
});

test('channel identity prefers the handle when both records have one', () => {
  assert.equal(
    rules.sameChannel({ name: 'Tech Brasil', handle: '@TechBR' }, { name: 'Outro', handle: '@techbr' }),
    true,
  );
  assert.equal(
    rules.sameChannel({ name: 'Tech Brasil', handle: '' }, { name: 'tech brasil', handle: '' }),
    true,
  );
  assert.equal(
    rules.sameChannel({ name: 'Tech Brasil', handle: '@a' }, { name: 'tech brasil', handle: '@b' }),
    false,
  );
});

test('the allowlist signature follows the matching fields', () => {
  const base = [{ name: 'Tech Brasil', handle: '@TechBR' }];
  assert.equal(rules.allowedSignature(base), rules.allowedSignature([...base]));
  assert.notEqual(rules.allowedSignature(base), rules.allowedSignature([{ name: 'Tech Brasil', handle: '@outro' }]));
  assert.equal(rules.allowedSignature([]), '');
});

test('lists keep entries the ASCII matcher cannot fold', () => {
  assert.deepEqual(plain(rules.normalizeList(['日本語', '日本語', '---'])), ['日本語', '---']);
  assert.equal(rules.hasListItem(['日本語'], '日本語'), true);
  assert.equal(rules.isBlockedChannel('Canal 日本語', ['日本語']), true);
  assert.deepEqual(plain(rules.nextBlockedChannels('日本語', ['日本語'])), []);
  assert.equal(rules.isAllowedChannel('日本語', '', [{ name: '日本語', handle: '' }]), true);
});

test('the block toggle adds, matches and removes by normalized name', () => {
  const blocked = ['Rick'];

  assert.equal(rules.isBlockedChannel('Rick Astley', blocked), true);
  assert.equal(rules.isBlockedChannel('Outro Canal', blocked), false);
  assert.deepEqual(plain(rules.nextBlockedChannels('Outro Canal', blocked)), ['Rick', 'Outro Canal']);
  assert.deepEqual(plain(rules.nextBlockedChannels('Rick Astley', blocked)), []);
  assert.deepEqual(plain(rules.nextBlockedChannels('  Outro Canal  ', null)), ['Outro Canal']);
});

test('the channel-name ceiling matches the service-worker save limit', () => {
  assert.equal(rules.MAX_CHANNEL_NAME_LENGTH, 60);
  assert.equal(rules.isUsableChannelName('a'.repeat(60)), true);
  assert.equal(rules.isUsableChannelName('a'.repeat(61)), false);
  assert.equal(rules.isUsableChannelName('   '), false);
});
