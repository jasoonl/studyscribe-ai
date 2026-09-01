import "dotenv/config";
import { createApp } from "./app";
import { isDirectNodeExecution, startStandaloneServer } from "./production";

export { createApp };
const app = createApp();

// Vercel imports this module as a function handler. Managed Node hosts execute
// the compiled entry directly, so only that process opens a TCP listener.
if (isDirectNodeExecution(import.meta.url)) {
  startStandaloneServer();
}

export default app;
