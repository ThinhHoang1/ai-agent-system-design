import { cfg, log } from "./config.js";
import { runRelay } from "./relay.js";
import { runTenant } from "./tenant.js";
import { runProvider } from "./provider.js";

const roles: Record<string, () => Promise<void>> = { relay: runRelay, tenant: runTenant, provider: runProvider };

const run = roles[cfg.role];
if (!run) {
  console.error(`unknown ROLE=${cfg.role}`);
  process.exit(2);
}
run().catch((e) => {
  log("fatal", e);
  process.exit(1);
});
