/**
 * O catálogo local dos canais inscritos.
 *
 * A suíte cobre a regra que o catálogo tomava emprestada de outro lugar: a
 * identidade do canal vem de `channel-rules.js`. Um card com handle e outro
 * sem, do mesmo canal, guardam uma linha só — e o teto do nome é o mesmo que a
 * allowlist aceita, para uma sugestão sempre poder ser salva.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const local = { channelCatalog: null };

globalThis.chrome = {
  storage: {
    local: {
      async get(defaults) {
        return { ...defaults, ...local };
      },
      async set(patch) {
        Object.assign(local, patch);
      },
    },
  },
};

const { getChannelCatalog, saveChannelCatalog } = await import('../src/background/channels.js?channels-test');

function reset() {
  local.channelCatalog = null;
}

test('a handleless card and a handled card store one row for the same channel', async () => {
  reset();

  const first = await saveChannelCatalog([
    { name: 'Tech Brasil', handle: '@TechBR', avatarUrl: 'https://yt3.example/b.jpg' },
  ]);
  assert.equal(first.channels.length, 1);

  const second = await saveChannelCatalog([{ name: 'Tech Brasil', handle: '', avatarUrl: '' }]);
  assert.equal(second.channels.length, 1, 'the same channel arriving without a handle is not a second row');
  assert.deepEqual(second.channels[0], {
    name: 'Tech Brasil',
    handle: '@TechBR',
    avatarUrl: 'https://yt3.example/b.jpg',
  });
});

test('the handle decides identity when both records have one', async () => {
  reset();

  await saveChannelCatalog([{ name: 'Tech Brasil', handle: '@TechBR' }]);
  const catalog = await saveChannelCatalog([{ name: 'Tech Brasil Oficial', handle: '@techbr' }]);

  assert.equal(catalog.channels.length, 1, 'case and @ do not create a second channel');
  assert.equal(catalog.channels[0].name, 'Tech Brasil Oficial', 'the newest card updates the display name');
});

test('names the ASCII matcher cannot fold still dedupe by normalized name', async () => {
  reset();

  await saveChannelCatalog([{ name: 'Cozinha da Vovó', handle: '' }]);
  const catalog = await saveChannelCatalog([{ name: 'cozinha da vovo', handle: '' }]);
  assert.equal(catalog.channels.length, 1);
});

test('different channels are kept apart and a legacy duplicate catalog is healed on read', async () => {
  reset();

  const saved = await saveChannelCatalog([
    { name: 'Tech Brasil', handle: '@TechBR' },
    { name: 'Cozinha da Vovó', handle: '@vovo' },
  ]);
  assert.equal(saved.channels.length, 2);

  local.channelCatalog = {
    updatedAt: 1,
    channels: [
      { name: 'Tech Brasil', handle: '@TechBR', avatarUrl: '' },
      { name: 'Tech Brasil', handle: '', avatarUrl: '' },
    ],
  };
  const healed = await getChannelCatalog();
  assert.equal(healed.channels.length, 1, 'an old catalog with both records reads back as one channel');
  assert.equal(healed.channels[0].handle, '@TechBR');
});

test('the catalog uses the allowlist name ceiling so every suggestion can be saved', async () => {
  reset();

  const longName = 'x'.repeat(61);
  const rejected = await saveChannelCatalog([{ name: longName, handle: '@long' }]);
  assert.equal(rejected.channels.length, 0, 'a name the allowlist refuses is not stored');

  const accepted = await saveChannelCatalog([{ name: 'y'.repeat(60), handle: '@ok' }]);
  assert.equal(accepted.channels.length, 1, 'the last allowed length still fits');

  await assert.rejects(saveChannelCatalog('Tech'), /lista de canais/);
});
