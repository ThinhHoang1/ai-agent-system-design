import amqp from "amqplib";
import { cfg, log, sleep } from "./config.js";

export const inQueue = (b: number) => `in.q.${b}`;
export const outQueue = (b: number) => `out.q.${b}`;

// FNV-1a: cheap, stable across processes and languages. Every replica must agree on the
// bucket for a conversation, so never use Math.random or a per-process salt here.
export function bucketOf(key: string, n = cfg.buckets): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % n;
}

export type Conn = Awaited<ReturnType<typeof amqp.connect>>;

export async function connect(): Promise<Conn> {
  for (let i = 0; ; i++) {
    try {
      const conn = await amqp.connect(cfg.amqpUrl);
      conn.on("close", () => {
        log("RabbitMQ connection closed, exiting so the orchestrator restarts us");
        process.exit(1);
      });
      return conn;
    } catch (e) {
      if (i > 60) throw e;
      await sleep(1000);
    }
  }
}

// Quorum queues: replicated, durable, and they support single-active-consumer.
//   x-single-active-consumer: only ONE consumer per queue gets messages; the others wait
//     as hot standbys. That gives per-queue ordering without writing a leader election.
//   x-delivery-limit + dead-letter: a message that keeps crashing its consumer ends up in
//     the DLQ instead of looping forever.
export async function declareTopology(ch: amqp.Channel) {
  await ch.assertExchange("dlx", "fanout", { durable: true });
  await ch.assertQueue("dlq", { durable: true, arguments: { "x-queue-type": "quorum" } });
  await ch.bindQueue("dlq", "dlx", "");
  for (let b = 0; b < cfg.buckets; b++) {
    for (const q of [inQueue(b), outQueue(b)]) {
      await ch.assertQueue(q, {
        durable: true,
        arguments: {
          "x-queue-type": "quorum",
          "x-single-active-consumer": true,
          "x-delivery-limit": 5,
          "x-dead-letter-exchange": "dlx",
        },
      });
    }
  }
}

// Publish and wait for the broker to confirm the write. Without confirms, "published" only
// means "handed to the socket", and a broker crash can still lose it.
export async function publishConfirmed(ch: amqp.ConfirmChannel, queue: string, payload: unknown) {
  ch.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), { persistent: true, contentType: "application/json" });
  await ch.waitForConfirms();
}
