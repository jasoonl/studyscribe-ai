# File storage on Cloudflare R2 (free)

StudyScribe can keep audio, slides and study-source files in Cloudflare R2 instead of Vercel Blob. R2's free tier is 10 GB of storage, 1 million writes and 10 million reads a month, and **no egress fees**, so playback never runs into a transfer limit. Vercel Blob stays as the fallback: if the four R2 variables are not all set, nothing changes.

**Before you start.** Cloudflare may ask for a payment method on file before it lets you enable R2, even though usage inside the free tier is not charged. Only continue if you are comfortable with that, and set a billing alert (step 7). Going past 10 GB would be billed at Cloudflare's R2 rates.

## Steps

1. **Create a Cloudflare account** at dash.cloudflare.com and open **R2 Object Storage** in the sidebar. Enable R2 when asked (this is where a payment method may be requested).
2. **Create a bucket** (for example `studyscribe-files`). Leave it private: do not enable the public `r2.dev` URL or a custom public domain. All reads go through the app, which checks access first.
3. **Note your Account ID** (shown on the R2 overview page, right-hand side).
4. **Create an API token**: R2 > **Manage API Tokens** > **Create API token**. Permission **Object Read & Write**, scoped to **only your bucket**. Copy the **Access Key ID** and **Secret Access Key** (the secret is shown once). The S3 endpoint it shows is `https://<account id>.r2.cloudflarestorage.com`; the app derives it, so you do not need to set it.
5. **Set the bucket CORS policy** (bucket > **Settings** > **CORS Policy** > Add). Browsers upload straight to R2 with a signed `PUT`, so this is required. Replace the production origin with yours:

   ```json
   [
     {
       "AllowedOrigins": [
         "https://YOUR-PRODUCTION-DOMAIN",
         "http://localhost:3000",
         "http://localhost:5173"
       ],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Using the Chrome extension? Add its origin, `chrome-extension://<extension id>`, to `AllowedOrigins`; that CORS entry is the only thing that lets it upload. The desktop app uses the production origin. The mobile app is not a browser and needs no CORS entry.
6. **Set the Vercel environment variables** (Project > Settings > Environment Variables, Production, tick **Sensitive** for the key and secret), then redeploy:

   | Variable | Value |
   | --- | --- |
   | `R2_ACCOUNT_ID` | your Cloudflare account id |
   | `R2_ACCESS_KEY_ID` | the token's access key id |
   | `R2_SECRET_ACCESS_KEY` | the token's secret |
   | `R2_BUCKET` | the bucket name |

   `R2_ENDPOINT` is optional and only for tests or a mock server. `R2_STORAGE_LIMIT_BYTES` optionally changes the 10 GB shown as the limit.
7. **Set an alert**: Cloudflare dashboard > **Notifications** > add an R2 usage / billing alert so you hear about it before 10 GB. Check **R2 > Metrics** now and then; the app does not measure R2 usage (listing the bucket would spend request quota), so the Admin page shows it as unmetered.
8. **Check it**: open **Admin > System health**. The Storage row should say Cloudflare R2 is active and the bucket is reachable (a signed HEAD on a fixed, non-existent key `.healthcheck` with a 5 second timeout: 404 or 200 means reachable and authorized, 403 means the key was refused; keys are never shown). Then upload a small file and a recording.

## Behaviour to know

- **Precedence:** R2 if all four variables are set, otherwise Vercel Blob, otherwise the legacy Forge API. Remove one R2 variable to fall back to Blob.
- **Existing files do not move.** Recordings already in Blob keep a key that R2 does not have, so they stop playing once R2 is active. Switch only when you accept that, or copy the objects across first (same keys) with any S3-compatible tool such as `rclone`.
- **Uploads** are one signed PUT at any size up to the app's 1 GB cap. The URL is bound to the file's content type and exact size and expires (3 hours for audio, 10 minutes for study sources).
- **The transfer budget and soft cap are off** for R2 because it has no egress charge.
- **Deleting** removes the object from the bucket (8 at a time, within about 40 seconds). If some deletions fail, those recordings and their rows are kept and the rest are removed; try again. While Blob is also configured, the same keys are best-effort removed from Blob too, so older recordings do not linger there.

## Follow-ups the owner may want

- Nothing here has been run against a real R2 bucket by the author; do step 8 before relying on it.
