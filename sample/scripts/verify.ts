// Checks the three promises of the design for one burst run:
//   1. nothing lost        2. nothing processed twice        3. per-conversation order kept
import { pool } from "../src/db.js";

const runId = process.env.RUN_ID;
if (!runId) {
  console.error("set RUN_ID (printed by npm run burst)");
  process.exit(2);
}
const like = `${runId}-%`;

const stored = await pool.query(`select count(*)::int n from inbound_events where conversation_id like $1`, [like]);
const delivered = await pool.query(`select count(*)::int n from tenant_inbox where conversation_id like $1`, [like]);

// Order check: within a conversation, the arrival order (recv_order) must follow seq.
const order = await pool.query(
  `select conversation_id, array_agg(seq order by recv_order) as seqs
   from tenant_inbox where conversation_id like $1 group by conversation_id`,
  [like],
);
let outOfOrder = 0;
for (const r of order.rows) {
  const seqs = (r.seqs as string[]).map(Number);
  for (let i = 1; i < seqs.length; i++) if (seqs[i] <= seqs[i - 1]) outOfOrder++;
}

const missing = await pool.query(
  `select e.provider_msg_id from inbound_events e
   left join tenant_inbox t on t.provider_msg_id = e.provider_msg_id
   where e.conversation_id like $1 and t.provider_msg_id is null`,
  [like],
);

const outbound = await pool.query(
  `select state, count(*)::int n from outbound_messages where conversation_id like $1 group by state order by state`,
  [like],
);
const doubleSent = await pool.query(
  `select count(*)::int n from (select client_msg_id from provider_sent where conversation_id like $1
     group by client_msg_id having count(*) > 1) d`,
  [like],
);

console.log(
  JSON.stringify(
    {
      inboundStored: stored.rows[0].n,
      deliveredToTenant: delivered.rows[0].n,
      missing: missing.rowCount,
      outOfOrderPairs: outOfOrder,
      outbound: Object.fromEntries(outbound.rows.map((r) => [r.state, r.n])),
      repliesSentTwiceToProvider: doubleSent.rows[0].n,
    },
    null,
    2,
  ),
);
if (missing.rowCount) console.log("missing (still in flight or in DLQ?):", missing.rows.slice(0, 10).map((r) => r.provider_msg_id));
await pool.end();
