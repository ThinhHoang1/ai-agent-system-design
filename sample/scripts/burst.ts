// Simulates the chat platform: many conversations, each sending messages in order,
// with retries and duplicate webhook deliveries spread across all relay replicas.
import { cfg, sleep } from "../src/config.js";
import { sign } from "../src/hmac.js";

const CONVERSATIONS = Number(process.env.CONVERSATIONS ?? 40);
const MESSAGES = Number(process.env.MESSAGES ?? 10);
const DUP_RATE = Number(process.env.DUP_RATE ?? 0.2);
const TENANTS = ["shop-a", "shop-b", "shop-c"];
const runId = Date.now().toString(36);

let sent = 0;
let duplicatesSent = 0;
let retries = 0;

async function postWebhook(events: unknown[]) {
  const body = JSON.stringify({ events });
  const headers = { "content-type": "application/json", "x-signature": sign(cfg.webhookSecret, body) };
  // Like a real platform: anything but 200 (or a dead replica) means "deliver again".
  for (let attempt = 0; attempt < 20; attempt++) {
    const relay = cfg.relayUrls[(Math.random() * cfg.relayUrls.length) | 0];
    try {
      const res = await fetch(`${relay}/webhook`, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
      if (res.ok) return;
    } catch {
      /* replica down */
    }
    retries++;
    await sleep(200 * (attempt + 1));
  }
  throw new Error("webhook never accepted");
}

async function conversation(i: number) {
  const tenantId = TENANTS[i % TENANTS.length];
  const conversationId = `${runId}-c${i}`;
  for (let m = 0; m < MESSAGES; m++) {
    const ev = { tenantId, conversationId, messageId: `${conversationId}-m${m}`, text: `message ${m}` };
    await postWebhook([ev]);
    sent++;
    if (Math.random() < DUP_RATE) {
      await postWebhook([ev]); // the platform re-delivers the same message
      duplicatesSent++;
    }
    await sleep(Math.random() * 50);
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: CONVERSATIONS }, (_, i) => conversation(i)));
console.log(
  JSON.stringify(
    { runId, conversations: CONVERSATIONS, messagesPerConversation: MESSAGES, sent, duplicatesSent, webhookRetries: retries, ms: Date.now() - t0 },
    null,
    2,
  ),
);
console.log(`\nNow wait a few seconds and run:  RUN_ID=${runId} npm run verify`);
