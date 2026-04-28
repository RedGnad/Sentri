import { runStandaloneLoop } from "./agent.js";

runStandaloneLoop().catch((err) => {
  console.error("Fatal agent error:", err);
  process.exit(1);
});
