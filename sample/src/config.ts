// All knobs come from env so the same image can play every role in docker-compose.
const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export const cfg = {
  role: process.env.ROLE ?? "relay", // relay | tenant | provider
  replica: process.env.REPLICA_ID ?? "local",
  port: num(process.env.PORT, 8080),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://app:app@localhost:55432/app",
  amqpUrl: process.env.AMQP_URL ?? "amqp://guest:guest@localhost:55672",
  buckets: num(process.env.BUCKETS, 32),
  webhookSecret: process.env.WEBHOOK_SECRET ?? "demo-webhook-secret",
  tenantSecret: process.env.TENANT_SECRET ?? "demo-tenant-secret",
  tenantUrl: process.env.TENANT_URL ?? "http://tenant:8080",
  providerUrl: process.env.PROVIDER_URL ?? "http://provider:8080",
  relayUrls: (process.env.RELAY_URLS ?? "http://localhost:18081").split(","),
  // Chaos knobs (0..1) so you can watch retries, dedupe and the DLQ do their job.
  tenantFailRate: num(process.env.TENANT_FAIL_RATE, 0),
  tenantDuplicateSendRate: num(process.env.TENANT_DUP_SEND_RATE, 0.1),
  provider5xxRate: num(process.env.PROVIDER_5XX_RATE, 0.1),
  provider4xxRate: num(process.env.PROVIDER_4XX_RATE, 0.02),
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const log = (...args: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 23), `[${cfg.replica}]`, ...args);
