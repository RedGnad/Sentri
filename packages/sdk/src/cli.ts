import { runMultiVaultLoop } from "./agent.js";

runMultiVaultLoop().catch((err) => {
  console.error("Fatal agent error:", err);
  process.exit(1);
});
