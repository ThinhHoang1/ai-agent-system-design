import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cfg, log, sleep } from "./config.js";
import { pool, waitForDb } from "./db.js";
import { sign, verify } from "./hmac.js";

// Mock "agent runtime" of a shop: receives ordered inbound messages and replies.
// It is deliberately unreliable (TENANT_FAIL_RATE) and sometimes sends a reply twice
// (TENANT_DUP_SEND_RATE) so you can watch the relay's retries and dedupe.
async function reply(job: { tenantId: string; conversationId: string; providerMsgId: string }) {
  const body = JSON.stringify({
    tenantId: job.tenantId,
    conversationId: job.conversationId,
    clientMsgId: `reply-${job.providerMsgId}`, // generated once, reused on every retry
    text: `auto-reply to ${job.providerMsgId}`,
  });
  const sends = Math.random() < cfg.tenantDuplicateSendRate ? 2 : 1;
  for (let s = 0; s < sends; s++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const relay = cfg.relayUrls[Math.floor(Math.random() * cfg.relayUrls.length)];
      try {
        const res = await fetch(`${relay}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-signature": sign(cfg.tenantSecret, body) },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) break;
      } catch {
        /* replica down: try another */
      }
      await sleep(300 * (attempt + 1));
    }
  }
}

export async function runTenant() {
  await waitForDb();
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.post("/inbound", async (c) => {
    const raw = await c.req.text();
    if (!verify(cfg.tenantSecret, raw, c.req.header("x-signature"))) return c.json({ error: "bad signature" }, 401);
    if (Math.random() < cfg.tenantFailRate) return c.json({ error: "chaos" }, 503);
    const job = JSON.parse(raw);
    // Idempotent consumer: redeliveries are expected, the primary key swallows them.
    const r = await pool.query(
      `insert into tenant_inbox (provider_msg_id, tenant_id, conversation_id, seq, delivered_by)
       values ($1,$2,$3,$4,$5) on conflict (provider_msg_id) do nothing`,
      [job.providerMsgId, job.tenantId, job.conversationId, job.seq, job.deliveredBy],
    );
    if (r.rowCount === 1) reply(job).catch((e) => log("reply failed", e));
    return c.json({ ok: true }); // 200 = received, not "agent finished"
  });
  serve({ fetch: app.fetch, port: cfg.port });
  log(`mock tenant listening on :${cfg.port} (fail rate ${cfg.tenantFailRate})`);
}
