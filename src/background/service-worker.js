/**
 * Service worker da extensão — o ponto de entrada.
 *
 * Duas responsabilidades que não se misturam:
 *   1. o bloqueio de URLs, que já existia;
 *   2. a colheita periódica do feed, que é nova.
 *
 * A colheita roda no relógio daqui (`chrome.alarms`), não por comando de fora:
 * o worker dorme quando ocioso e nada externo consegue acordá-lo, então a
 * extensão é quem inicia. Como efeito colateral, nenhuma LLM consegue mandar
 * esta extensão fazer nada.
 */
import { addBlockRule, initializeRules, removeBlockRule } from './blocking.js';
import { flushQueue, pingBridge, readDelivery } from './bridge-client.js';
import {
  collectNow,
  readLastRun,
  readRetryMode,
  RETRY_MODE_DELIVERY,
  retryPending,
} from './collector.js';
import { flushPending, refreshBadge } from './delivery-health.js';
import { ALARM_NAME, getSettings, rescheduleAlarm, RETRY_ALARM_NAME, saveSettings } from './settings.js';
import { collectSubscriptions, readLastSubscriptionsRun } from './subscriptions.js';

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await initializeRules();
    await refreshBadge();
    await rescheduleAlarm();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await initializeRules();
    await refreshBadge();
    await rescheduleAlarm();
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void collectNow('alarme');
  else if (alarm.name === RETRY_ALARM_NAME) void retryNow();
});

/** O alarme de retentativa obedece ao modo guardado: colher ou só reenviar. */
async function retryNow() {
  const mode = await readRetryMode();
  if (mode === RETRY_MODE_DELIVERY) return retryPending();
  return collectNow('retentativa');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true; // mantém o canal aberto para a resposta assíncrona
});

async function handleMessage(message) {
  switch (message && message.action) {
    case 'addBlockRule':
      return addBlockRule(message.url);
    case 'removeBlockRule':
      return removeBlockRule(message.ruleId);

    case 'collectNow':
      return { action: 'collectNow', summary: await collectNow('manual') };

    case 'collectSubscriptions':
      return { action: 'collectSubscriptions', summary: await collectSubscriptions('manual') };

    case 'status':
      return {
        action: 'status',
        settings: await getSettings(),
        lastRun: await readLastRun(),
        lastSubscriptionsRun: await readLastSubscriptionsRun(),
        delivery: await readDelivery(),
        bridge: await pingBridge(),
      };

    case 'saveSettings':
      await saveSettings(message.patch ?? {});
      await rescheduleAlarm();
      return { action: 'saveSettings', ok: true, settings: await getSettings() };

    case 'flushQueue':
      return { action: 'flushQueue', result: await flushQueue() };

    case 'flushNow': {
      const { delivery, queueLength } = await flushPending();
      return { action: 'flushNow', delivery, queueLength };
    }

    case 'pingBridge':
      return { action: 'pingBridge', bridge: await pingBridge() };

    default:
      return { action: 'error', message: 'ação desconhecida' };
  }
}
