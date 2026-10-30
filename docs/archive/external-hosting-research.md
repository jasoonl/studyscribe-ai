# External hosting research

## Railway
Source: https://docs.railway.com/guides/express

Railway’s official Express guide says deployments can be connected from GitHub and that Railway detects the Node app and uses the `start` script from `package.json`. Environment variables such as `PORT` and `DATABASE_URL` are configured in the Railway service settings. The app must listen on the platform-provided port rather than a hardcoded port.

Railway health checks are documented separately at https://docs.railway.com/deployments/healthchecks and should be used to gate deployment readiness.

## Render
Source: https://render.com/docs/deploy-node-express-app

Render’s official Node/Express guide deploys from a connected GitHub repository. It exposes configurable Build Command and Start Command fields, supports environment variables/secrets, and links to official health-check guidance. The deployment must use the platform-provided `PORT` value and a production start command.

Render also exposes separate service types for web services, background workers, and cron jobs. That distinction matters because StudyScribe currently performs background transcription work from the web service process; this behavior must be checked for the chosen host and, if necessary, separated into a durable worker/queue architecture.

## Portability implications for StudyScribe

The application is a React/Vite frontend served by an Express server with tRPC, Drizzle/TiDB, Manus storage helpers, built-in LLM calls, Google OAuth, custom JWT sessions, Resend, AssemblyAI, and Web Push. The largest migration risks are Manus-specific storage/API helpers, environment-variable availability, OAuth redirect origins, service-worker HTTPS/custom-domain requirements, and the durability of fire-and-forget transcription jobs on a sleeping or redeployed web service. No production migration has been performed.
