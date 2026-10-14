import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cfg, log } from "./config.js";
import { pool, waitForDb } from "./db.js";

// Mock chat platform Send API (think Messenger/Zalo). Randomly returns 5xx (transient)
// and 4xx (permanent) so the outbound worker's error classification is visible.
export async function runProvider() {
  await waitForDb();
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.post("/send", async (c) => {
    const roll = Math.random();
    if (roll < cfg.provider5xxRate) return c.json({ error: "temporarily unavailable" }, 503);
    if (roll < cfg.provider5xxRate + cfg.provider4xxRate) return c.json({ error: "outside messaging window" }, 400);
    const m = await c.req.json();
    await pool.query(
      `insert into provider_sent (tenant_id, conversation_id, client_msg_id) values ($1,$2,$3)`,
      [m.tenantId, m.conversationId, m.clientMsgId],
    );
    return c.json({ ok: true });
  });
  serve({ fetch: app.fetch, port: cfg.port });
  log(`mock provider listening on :${cfg.port} (5xx ${cfg.provider5xxRate}, 4xx ${cfg.provider4xxRate})`);
}
