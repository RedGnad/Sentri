// Public surface of @steward/paymaster — consumed both by the standalone
// service (src/server.ts) and by the agent server, which grafts the RPC handler
// onto a POST /paymaster route so we don't run a separate Render instance.
export * from "./sign.js";
export * from "./policy.js";
export { config, assertServerConfig } from "./config.js";
export {
  handlePaymasterRpc,
  paymasterConfigured,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./handler.js";
