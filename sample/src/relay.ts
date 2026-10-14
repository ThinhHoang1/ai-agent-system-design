import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type amqp from "amqplib";
import { cfg, log, sleep } from "./config.js";
import { pool, migrate, waitForDb } from "./db.js";
import { bucketOf, connect, declareTopology, inQueue, outQueue, publishConfirmed } from "./mq.js";
import { sign, verify } from "./hmac.js";

type InboundEvent = { tenantId: string; conversationId: string; messageId: string; text: string };
type InboundJob = { seq: number; tenantId: string; conversationId: string; providerMsgId: string; text: string };

const convKey = (tenantId: string, conversationId: string) => `${tenantId}:${conversationId}`;

// ────────────────────────────────────────────────────────────────────────────
// 1. INBOUND: provider webhook → Postgres → bucket queue. Answer 200 only at the end.
// ────────────────────────────────────────────────────────────────────────────
async function acceptInbound(pub: amqp.ConfirmChannel, ev: InboundEvent): Promise<"new" | "duplicate"> {
  const inserted = await pool.query(
    `insert into inbound_events (tenant_id, conversation_id, provider_msg_id, text)
     values ($1,$2,$3,$4)
     on conflict (tenant_id, provider_msg_id) do nothing
     returning seq`,
    [ev.tenantId, ev.conversationId, ev.messageId, ev.text],
  );

  let seq: number;
  if (inserted.rowCount === 1) {
    seq = Number(inserted.rows[0].seq);
  } else {
    // Seen before. If the earlier attempt stored it but crashed before reaching the queue,
    // published_at is still null and we must publish now; otherwise this is a pure retry.
    const prev = await pool.query(
      `select seq, published_at from inbound_events where tenant_id=$1 and provider_msg_id=$2`,
      [ev.tenantId, ev.messageId],
    );
    if (prev.rows[0].published_at) return "duplicate";
    seq = Number(prev.rows[0].seq);
  }

  const job: InboundJob = {
    seq,
    tenantId: ev.tenantId,
    conversationId: ev.conversationId,
    providerMsgId: ev.messageId,
    text: ev.text,
  };
  await publishConfirmed(pub, inQueue(bucketOf(convKey(ev.tenantId, ev.conversationId))), job);
  await pool.query(`update inbound_events set published_at = now() where seq = $1`, [seq]);
  return "new";
}

// ────────────────────────────────────────────────────────────────────────────
// 2. ORDERED DELIVERY: one active consumer per bucket, a seq gate, inline retries.
// ────────────────────────────────────────────────────────────────────────────
async function pushToTenant(job: InboundJob): Promise<boolean> {
  const body = JSON.stringify({ ...job, deliveredBy: cfg.replica });
  try {
    const res = await fetch(`${cfg.tenantUrl}/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sign(cfg.tenantSecret, body) },
      body,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function handleInbound(ch: amqp.Channel, pub: amqp.ConfirmChannel, msg: amqp.ConsumeMessage) {
  const job = JSON.parse(msg.content.toString()) as InboundJob;
  const key = convKey(job.tenantId, job.conversationId);

  const gate = await pool.query(`select last_seq from order_gate where conversation_key = $1`, [key]);
  const lastSeq = gate.rows[0] ? Number(gate.rows[0].last_seq) : 0;
  if (job.seq <= lastSeq) {
    log(`gate drop ${key} seq=${job.seq} <= ${lastSeq}`);
    ch.ack(msg);
    return;
  }

  // Retry INLINE instead of nack+requeue: a requeued message can come back after newer
  // ones, the gate would then drop it, and the message is silently lost. Holding the
  // message keeps order at the cost of blocking this bucket while the tenant is down.
  const backoff = [500, 1000, 2000, 4000, 8000];
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (await pushToTenant(job)) {
      // Advance the gate only AFTER delivery. Crash between push and this update means a
      // redelivery, and the tenant dedupes by providerMsgId (at-least-once + idempotent).
      await pool.query(
        `insert into order_gate (conversation_key, last_seq) values ($1,$2)
         on conflict (conversation_key) do update set last_seq = greatest(order_gate.last_seq, excluded.last_seq)`,
        [key, job.seq],
      );
      ch.ack(msg);
      return;
    }
    if (attempt < backoff.length) await sleep(backoff[attempt]);
  }
  log(`tenant unreachable, parking seq=${job.seq} in DLQ`);
  await publishConfirmed(pub, "dlq", { kind: "inbound", ...job });
  ch.ack(msg);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. OUTBOUND: idempotent accept (clientMsgId), then a worker that knows 4xx from 5xx.
// ────────────────────────────────────────────────────────────────────────────
async function handleOutbound(ch: amqp.Channel, msg: amqp.ConsumeMessage) {
  const { id } = JSON.parse(msg.content.toString()) as { id: number };
  const row = (await pool.query(`select * from outbound_messages where id = $1`, [id])).rows[0];
  if (!row || row.state !== "queued") {
    ch.ack(msg); // already finished by an earlier delivery: idempotent consumer
    return;
  }

  const backoff = [1000, 2000, 4000, 8000];
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(`${cfg.providerUrl}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: row.tenant_id,
          conversationId: row.conversation_id,
          clientMsgId: row.client_msg_id,
          text: row.text,
        }),
        signal: AbortSignal.timeout(5000),
      });
      status = res.status;
    } catch {
      status = 0; // network error / timeout: treat as transient
    }

    if (status >= 200 && status < 300) {
      await pool.query(`update outbound_messages set state='sent', attempts=$2, updated_at=now() where id=$1`, [id, attempt + 1]);
      break;
    }
    if (status >= 400 && status < 500) {
      // Permanent: the provider rejected the message itself. Retrying only clogs the queue.
      await pool.query(
        `update outbound_messages set state='failed', attempts=$2, last_error=$3, updated_at=now() where id=$1`,
        [id, attempt + 1, `provider ${status}`],
      );
      break;
    }
    if (attempt >= backoff.length) {
      await pool.query(
        `update outbound_messages set state='failed', attempts=$2, last_error=$3, updated_at=now() where id=$1`,
        [id, attempt + 1, `gave up after ${attempt + 1} tries (last ${status || "network"})`],
      );
      break;
    }
    await sleep(backoff[attempt]);
  }
  ch.ack(msg);
}

// ────────────────────────────────────────────────────────────────────────────
// 4. LEASE: a periodic job that must run on exactly one replica at a time.
// ────────────────────────────────────────────────────────────────────────────
async function tryLease(name: string, ttlSeconds: number): Promise<boolean> {
  const r = await pool.query(
    `insert into leases (name, holder, expires_at) values ($1, $2, now() + make_interval(secs => $3))
     on conflict (name) do update set holder = excluded.holder, expires_at = excluded.expires_at
       where leases.expires_at < now() or leases.holder = excluded.holder
     returning holder`,
    [name, cfg.replica, ttlSeconds],
  );
  return r.rowCount === 1;
}

function startSweeper() {
  let wasLeader = false;
  setInterval(async () => {
    try {
      const leader = await tryLease("stuck-outbound-sweeper", 15);
      if (leader !== wasLeader) log(leader ? "acquired lease: I run the sweeper now" : "lost lease");
      wasLeader = leader;
      if (!leader) return;
      const stuck = await pool.query(
        `select count(*)::int as n from outbound_messages where state='queued' and created_at < now() - interval '2 minutes'`,
      );
      if (stuck.rows[0].n > 0) log(`sweeper: ${stuck.rows[0].n} outbound messages stuck in queued`);
    } catch (e) {
      log("sweeper error", (e as Error).message);
    }
  }, 5000);
}

// ────────────────────────────────────────────────────────────────────────────
export async function runRelay() {
  await waitForDb();
  await migrate();
  const conn = await connect();
  const setup = await conn.createChannel();
  await declareTopology(setup);
  await setup.close();

  const pub = await conn.createConfirmChannel();
  const consumeCh = await conn.createChannel();
  await consumeCh.prefetch(1); // per consumer: process one message at a time per bucket

  for (let b = 0; b < cfg.buckets; b++) {
    await consumeCh.consume(inQueue(b), (m) => {
      if (m) handleInbound(consumeCh, pub, m).catch((e) => log("inbound handler crashed", e));
    });
    await consumeCh.consume(outQueue(b), (m) => {
      if (m) handleOutbound(consumeCh, m).catch((e) => log("outbound handler crashed", e));
    });
  }
  startSweeper();

  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, replica: cfg.replica }));

  app.post("/webhook", async (c) => {
    const raw = await c.req.text();
    if (!verify(cfg.webhookSecret, raw, c.req.header("x-signature"))) return c.json({ error: "bad signature" }, 401);
    const { events } = JSON.parse(raw) as { events: InboundEvent[] };
    let fresh = 0;
    let dup = 0;
    try {
      for (const ev of events) ((await acceptInbound(pub, ev)) === "new" ? fresh++ : dup++);
    } catch (e) {
      // Not durable yet → tell the provider to retry the whole batch. Dedupe makes it safe.
      log("webhook failed, asking provider to retry", (e as Error).message);
      return c.json({ error: "retry" }, 500);
    }
    return c.json({ ok: true, accepted: fresh, duplicates: dup });
  });

  app.post("/messages", async (c) => {
    const raw = await c.req.text();
    if (!verify(cfg.tenantSecret, raw, c.req.header("x-signature"))) return c.json({ error: "bad signature" }, 401);
    const m = JSON.parse(raw) as { tenantId: string; conversationId: string; clientMsgId: string; text: string };
    const r = await pool.query(
      `insert into outbound_messages (tenant_id, conversation_id, client_msg_id, text) values ($1,$2,$3,$4)
       on conflict (tenant_id, client_msg_id) do nothing returning id`,
      [m.tenantId, m.conversationId, m.clientMsgId, m.text],
    );
    if (r.rowCount === 0) return c.json({ ok: true, deduped: true }, 200);
    try {
      await publishConfirmed(pub, outQueue(bucketOf(convKey(m.tenantId, m.conversationId))), { id: Number(r.rows[0].id) });
    } catch {
      return c.json({ error: "queue unavailable" }, 503); // the sweeper will flag it
    }
    return c.json({ ok: true, id: Number(r.rows[0].id) }, 202);
  });

  serve({ fetch: app.fetch, port: cfg.port });
  log(`relay listening on :${cfg.port}, consuming ${cfg.buckets}x2 queues`);
}
