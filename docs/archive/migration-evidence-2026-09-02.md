# External migration evidence

## Vercel deployment
- Latest deployment URL: https://studyscribe-5f4jp0n9d-jasoonls-projects.vercel.app (earlier Ready deployment); later redeploy for schema initialization: https://studyscribe-m6oy74htk-jasoonls-projects.vercel.app.
- Vercel `/healthz` returned HTTP 200 with `{"status":"ok"}` on the current Ready build.
- Vercel `/api/auth/me` returned HTTP 401 with `{"error":"Not authenticated"}` without a session.
- Vercel `/api/auth/google?mode=login` returned HTTP 200 with a Google consent URL and callback `https://studyscribe-ai.vercel.app/api/auth/google/callback`.
- Vercel runtime errors in the latest 30-minute check were empty before schema initialization.

## Schema initializer failure
- POST `/api/admin/initialize-database` with the securely configured schema token returned HTTP 500.
- Vercel runtime error: `CREATE command denied to user '4DPE8FejMuJ8EvM.root'@'%' for table '_studyscribe_schema_init'` (`ER_TABLEACCESS_DENIED_ERROR`).
- The TiDB credential is now accepted for connection, but the connected user cannot CREATE tables. Do not repeatedly retry initialization. The next action is to inspect TiDB grants / use the correct privileged database user in the TiDB Connect dialog.
- Runtime warning also reports MySQL2 received an invalid `kind` connection option because the discriminant was passed through to `createPool`; this should be cleaned up separately.

## Sources
- Vercel project configuration docs: https://vercel.com/docs/project-configuration/vercel-json
- TiDB Cloud username prefix guidance: https://docs.pingcap.com/tidbcloud/select-cluster-tier#user-name-prefix
- TiDB privilege management: https://docs.pingcap.com/tidb/stable/privilege-management/
- TiDB GRANT reference: https://docs.pingcap.com/tidb/stable/sql-statement-grant-privileges/
