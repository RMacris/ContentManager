import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

const storage = {
  blockedUrls: [],
  hideOldVideos: true,
  hideGamesAndAds: true,
  maxAgeHours: 72,
  channelMode: 'off',
  blockKeywords: false,
  blockedKeywords: null,
  blockedChannels: null,
  selectedChannels: null,
  allowedChannels: null,
};
const localStorage = { channelCatalog: null };
let dynamicRules = [];
let failNextRuleUpdate = false;
let injectedTabs = [];
let lastTabsQuery = null;
let failInjectionForTab = null;

globalThis.chrome = {
  runtime: {
    getURL: () => 'chrome-extension://test-extension/',
  },
  tabs: {
    async query(queryInfo) {
      lastTabsQuery = queryInfo;
      return [{ id: 1 }, { id: 2 }, { id: 99 }];
    },
  },
  scripting: {
    async executeScript({ target, files }) {
      if (failInjectionForTab === target.tabId) throw new Error('Simulated injection failure');
      injectedTabs.push({ tabId: target.tabId, files: [...files] });
    },
  },
  storage: {
    sync: {
      async get(defaults) {
        return { ...defaults, ...storage };
      },
      async set(patch) {
        Object.assign(storage, patch);
      },
    },
    local: {
      async get(defaults) {
        return { ...defaults, ...localStorage };
      },
      async set(patch) {
        Object.assign(localStorage, patch);
      },
    },
  },
  declarativeNetRequest: {
    async isRegexSupported({ regex }) {
      try {
        new RegExp(regex);
        return { isSupported: true };
      } catch {
        return { isSupported: false };
      }
    },
    async getDynamicRules() {
      return dynamicRules;
    },
    async updateDynamicRules({ removeRuleIds, addRules }) {
      if (failNextRuleUpdate) {
        failNextRuleUpdate = false;
        throw new Error('Simulated DNR update failure');
      }

      for (const rule of addRules) {
        const domains = rule.condition.excludedInitiatorDomains ?? [];
        if (domains.some((domain) => domain.includes('://'))) {
          throw new TypeError('excludedInitiatorDomains must contain domains, not URLs');
        }
      }

      dynamicRules = [
        ...dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id)),
        ...addRules,
      ];
    },
  },
};

const { addBlockRule, removeBlockRule } = await import('../src/background/blocking.js?extension-flow-test');
const { getChannelCatalog, saveChannelCatalog } = await import('../src/background/channels.js?extension-flow-test');
const {
  getSettings,
  saveSettings,
  PRESET_AI_KEYWORDS,
  DEFAULT_SETTINGS,
} = await import('../src/background/settings.js?extension-flow-test');
const { LIMITS } = globalThis.YTISettingsContract;
const { injectFilterIntoOpenTabs } = await import('../src/background/injection.js?extension-flow-test');

beforeEach(() => {
  storage.blockedUrls = [];
  storage.hideOldVideos = true;
  storage.hideGamesAndAds = true;
  storage.maxAgeHours = 72;
  delete storage.maxAgeDays;
  storage.channelMode = 'off';
  storage.blockKeywords = false;
  storage.blockedKeywords = null;
  storage.blockedChannels = null;
  storage.selectedChannels = null;
  storage.allowedChannels = null;
  localStorage.channelCatalog = null;
  dynamicRules = [];
  failNextRuleUpdate = false;
  injectedTabs = [];
  lastTabsQuery = null;
  failInjectionForTab = null;
});

test('adding a regex creates a working DNR rule and persists it', async () => {
  const pattern = '.*youtube.com/shorts.*';

  const response = await addBlockRule(pattern);

  assert.equal(response.action, 'success');
  assert.equal(storage.blockedUrls[0].urlPattern, pattern);
  assert.equal(dynamicRules[0].condition.regexFilter, pattern);
  assert.deepEqual(dynamicRules[0].condition.resourceTypes, ['main_frame']);
});

test('removing one URL keeps the remaining rule active and persisted', async () => {
  storage.blockedUrls = [
    { urlPattern: '.*youtube.com/shorts.*', ruleId: 'keep' },
    { urlPattern: '.*tiktok.*', ruleId: 'remove' },
  ];

  const response = await removeBlockRule('remove');

  assert.equal(response.action, 'success');
  assert.deepEqual(storage.blockedUrls.map(({ ruleId }) => ruleId), ['keep']);
  assert.equal(dynamicRules.length, 1);
  assert.equal(dynamicRules[0].condition.regexFilter, '.*youtube.com/shorts.*');
});

test('a DNR failure does not save a blocked URL that is not actually blocked', async () => {
  failNextRuleUpdate = true;

  await assert.rejects(addBlockRule('.*youtube.com/shorts.*'), /Simulated DNR update failure/);

  assert.deepEqual(storage.blockedUrls, []);
  assert.deepEqual(dynamicRules, []);
});

test('settings persist an independent toggle and a custom recommendation age', async () => {
  storage.blockedKeywords = ['ia'];

  const saved = await saveSettings({ hideOldVideos: false, maxAgeHours: 336 });

  assert.deepEqual(saved, {
    hideOldVideos: false,
    hideGamesAndAds: true,
    maxAgeHours: 336,
    channelMode: 'off',
    blockKeywords: false,
    blockedKeywords: ['ia'],
    blockedChannels: [],
    selectedChannels: [],
    allowedChannels: [],
  });
  assert.deepEqual(await getSettings(), saved);
});

test('the channel mode and the selected channel list persist', async () => {
  const saved = await saveSettings({
    channelMode: 'selected',
    selectedChannels: [
      { name: 'Tech Brasil', handle: '@TechBR' },
      { name: 'tech brasil', handle: '@techbr' },
      { name: 'Cozinha' },
    ],
  });

  assert.equal(saved.channelMode, 'selected');
  assert.deepEqual(saved.selectedChannels, [
    { name: 'Tech Brasil', handle: '@TechBR' },
    { name: 'Cozinha', handle: '' },
  ]);
  assert.deepEqual((await getSettings()).selectedChannels, saved.selectedChannels);
  assert.equal(storage.channelMode, 'selected');

  await assert.rejects(saveSettings({ channelMode: 'closed' }), /modo de canais/);
  assert.equal(storage.channelMode, 'selected', 'a rejected mode is not saved');
});

test('the first read migrates the old day setting to hours once', async () => {
  delete storage.maxAgeHours;
  storage.maxAgeDays = 14;

  const settings = await getSettings();

  assert.equal(settings.maxAgeHours, 336);
  assert.equal(storage.maxAgeHours, 336, 'the migrated value is written back');
});

test('the AI keyword preset is seeded once and never overwritten', async () => {
  const first = await getSettings();

  assert.equal(first.blockKeywords, false, 'the toggle ships off');
  assert.deepEqual(first.blockedKeywords, PRESET_AI_KEYWORDS);
  assert.deepEqual(first.blockedChannels, []);

  const edited = await saveSettings({ blockedKeywords: ['chatgpt'] });
  assert.deepEqual(edited.blockedKeywords, ['chatgpt']);

  assert.deepEqual((await getSettings()).blockedKeywords, ['chatgpt'], 'the preset does not come back');
});

test('keyword and channel lists are cleaned and capped before saving', async () => {
  const saved = await saveSettings({ blockedKeywords: ['  ChatGPT ', 'chatgpt', 'claude', ''] });

  assert.deepEqual(saved.blockedKeywords, ['ChatGPT', 'claude'], 'trimmed, deduped, without blanks');

  await assert.rejects(saveSettings({ blockedKeywords: 'chatgpt' }), /lista de textos/);
  await assert.rejects(saveSettings({ blockedKeywords: ['x'.repeat(61)] }), /60 caracteres/);
  await assert.rejects(
    saveSettings({ blockedChannels: Array.from({ length: 101 }, (_, index) => `canal ${index}`) }),
    /100 itens/,
  );
  assert.equal(storage.blockedChannels, null, 'a rejected list is not saved');
});

test('saved lists use the same equality as the matcher and the popup', async () => {
  const saved = await saveSettings({
    blockedKeywords: ['GPT-4', 'gpt 4', 'Claude'],
    blockedChannels: ['Rick Astley', 'rick astley'],
    allowedChannels: [
      { name: 'Tech Brasil', handle: '@TechBR' },
      { name: 'tech brasil', handle: '@techbr' },
      { name: 'Cozinha', handle: '' },
    ],
  });

  assert.deepEqual(saved.blockedKeywords, ['GPT-4', 'Claude']);
  assert.deepEqual(saved.blockedChannels, ['Rick Astley']);
  assert.deepEqual(saved.allowedChannels, [
    { name: 'Tech Brasil', handle: '@TechBR' },
    { name: 'Cozinha', handle: '' },
  ]);
});

test('the keyword toggle persists like the other switches', async () => {
  const saved = await saveSettings({ blockKeywords: true });

  assert.equal(saved.blockKeywords, true);
  assert.equal((await getSettings()).blockKeywords, true);
});

test('reloading the extension revives the filter in open YouTube tabs without a refresh', async () => {
  failInjectionForTab = 99;

  await injectFilterIntoOpenTabs();

  assert.equal(lastTabsQuery.url, 'https://www.youtube.com/*');
  assert.deepEqual(injectedTabs.map(({ tabId }) => tabId), [1, 2], 'a failing tab does not break the others');
  assert.deepEqual(injectedTabs[0].files, [
    'src/content/age-core.js',
    'src/content/keyword-core.js',
    'src/content/channel-rules.js',
    'src/shared/settings-contract.js',
    'src/content/youtube-dom.js',
    'src/content/content-runtime.js',
    'src/content/content-settings.js',
    'src/content/channel-catalog.js',
    'src/content/channel-button.js',
    'src/content/age-filter.js',
  ]);
});

test('the subscriptions catalog merges what the channels page collected', async () => {
  const first = await saveChannelCatalog([
    { name: 'Asmongold TV', handle: '@AsmongoldTV', avatarUrl: '//yt3.example/a.jpg' },
    { name: 'Tech Brasil', handle: '@TechBR', avatarUrl: 'https://yt3.example/b.jpg' },
  ]);
  assert.equal(first.channels.length, 2);
  assert.equal(first.channels[0].avatarUrl, 'https://yt3.example/a.jpg', 'protocol-relative avatar becomes https');

  const merged = await saveChannelCatalog([{ name: 'Cozinha da Vovó', handle: '@vovo' }]);
  assert.equal(merged.channels.length, 3, 'a new visit merges instead of replacing');

  const updated = await saveChannelCatalog([
    { name: 'Asmongold TV', handle: '@AsmongoldTV', avatarUrl: 'https://yt3.example/a2.jpg' },
  ]);
  assert.equal(updated.channels.length, 3, 'the same handle updates instead of duplicating');
  const catalog = await getChannelCatalog();
  assert.equal(catalog.channels.find((entry) => entry.handle === '@AsmongoldTV').avatarUrl, 'https://yt3.example/a2.jpg');
});

test('allowed channels persist in sync with name and handle', async () => {
  const saved = await saveSettings({
    allowedChannels: [
      { name: 'Tech Brasil', handle: '@TechBR' },
      { name: 'tech brasil', handle: '@techbr' },
      { name: 'Cozinha' },
    ],
  });

  assert.deepEqual(saved.allowedChannels, [
    { name: 'Tech Brasil', handle: '@TechBR' },
    { name: 'Cozinha', handle: '' },
  ]);
  assert.deepEqual((await getSettings()).allowedChannels, saved.allowedChannels);

  await assert.rejects(saveSettings({ allowedChannels: 'Tech' }), /lista/);
  await assert.rejects(
    saveSettings({ allowedChannels: Array.from({ length: 51 }, (_, index) => ({ name: `canal ${index}` })) }),
    /50 canais/,
  );
});

test('invalid recommendation ages are rejected without changing saved settings', async () => {
  await assert.rejects(saveSettings({ maxAgeHours: 0 }), /entre 1 e 8760 horas/);
  assert.equal(storage.maxAgeHours, 72);
});

test('the service worker takes defaults and limits from the shared contract', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    hideOldVideos: true,
    hideGamesAndAds: true,
    maxAgeHours: 72,
    channelMode: 'off',
    blockKeywords: false,
  });
  assert.deepEqual(LIMITS, {
    maxAgeHours: { min: 1, max: 8760 },
    maxListItems: 100,
    maxItemLength: 60,
    maxAllowedChannels: 50,
    maxSelectedChannels: 50,
  });
});

test('the age limit accepts the contract boundaries and persists them', async () => {
  const min = LIMITS.maxAgeHours.min;
  const max = LIMITS.maxAgeHours.max;

  assert.equal((await saveSettings({ maxAgeHours: min })).maxAgeHours, 1);
  assert.equal(storage.maxAgeHours, 1);

  assert.equal((await saveSettings({ maxAgeHours: max })).maxAgeHours, 8760);
  assert.equal(storage.maxAgeHours, 8760);

  await assert.rejects(
    saveSettings({ maxAgeHours: max + 1 }),
    /entre 1 e 8760 horas/,
  );
  assert.equal(storage.maxAgeHours, 8760, 'a rejected boundary does not overwrite the saved value');
});
