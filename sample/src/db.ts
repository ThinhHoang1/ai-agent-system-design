import pg from "pg";
import { cfg, log, sleep } from "./config.js";

export const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 });

export async function waitForDb() {
  for (let i = 0; ; i++) {
    try {
      await pool.query("select 1");
      return;
    } catch (e) {
      if (i > 60) throw e;
      await sleep(1000);
    }
  }
}

// Three replicas boot at the same time. Concurrent "create table if not exists" can still
// collide in Postgres' catalog, so migrations run under one advisory lock.
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(424242)");
    await client.query(`
      -- Inbound: persisted BEFORE we answer the webhook. seq is the global order.
      create table if not exists inbound_events (
        seq              bigserial primary key,
        tenant_id        text not null,
        conversation_id  text not null,
        provider_msg_id  text not null,
        text             text not null,
        published_at     timestamptz,           -- null = stored but not yet on the queue
        created_at       timestamptz not null default now(),
        unique (tenant_id, provider_msg_id)      -- provider retries collapse here
      );

      -- Ordering gate: highest seq delivered per conversation. Older seq = stale, drop it.
      create table if not exists order_gate (
        conversation_key text primary key,
        last_seq         bigint not null
      );

      -- Outbound: the agent's replies. client_msg_id makes retries safe.
      create table if not exists outbound_messages (
        id               bigserial primary key,
        tenant_id        text not null,
        conversation_id  text not null,
        client_msg_id    text not null,
        text             text not null,
        state            text not null default 'queued',   -- queued | sent | failed
        attempts         int  not null default 0,
        last_error       text,
        created_at       timestamptz not null default now(),
        updated_at       timestamptz not null default now(),
        unique (tenant_id, client_msg_id)
      );

      -- Leases: "only one replica may run this job" without a leader election.
      create table if not exists leases (
        name       text primary key,
        holder     text not null,
        expires_at timestamptz not null
      );

      -- Demo-only tables written by the mock tenant and mock provider so we can verify.
      create table if not exists tenant_inbox (
        recv_order       bigserial,
        provider_msg_id  text primary key,
        tenant_id        text not null,
        conversation_id  text not null,
        seq              bigint not null,
        delivered_by     text not null,
        received_at      timestamptz not null default now()
      );
      create table if not exists provider_sent (
        id               bigserial primary key,
        tenant_id        text not null,
        conversation_id  text not null,
        client_msg_id    text not null,
        sent_at          timestamptz not null default now()
      );
    `);
    log("migrations ok");
  } finally {
    await client.query("select pg_advisory_unlock(424242)").catch(() => {});
    client.release();
  }
}
