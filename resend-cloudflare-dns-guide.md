# Cloudflare DNS Guide for Resend Domain Verification

## Important ownership check before making changes

**Do not add these records to an unrelated Cloudflare zone.** Resend requires a domain that you own and control. The supplied target, `studyscribe-ai.manus.space`, is currently a Manus-managed subdomain, so it will only be possible to add these records if the parent DNS administrator has delegated that subdomain to a Cloudflare zone you control. If your Cloudflare dashboard does not list a zone that authoritatively manages `studyscribe-ai.manus.space` (or its parent `manus.space`), stop here. Instead, connect a custom domain you own to the StudyScribe project and verify that domain in Resend. Resend’s own documentation requires a domain you own rather than a shared/public domain. [1]

> **Cloudflare naming rule:** The Name field is relative to the Cloudflare zone. The names below are shown **exactly as supplied by Resend**. Use them unchanged only when your Cloudflare zone is `manus.space`, because Cloudflare will append `.manus.space`. If the zone is exactly `studyscribe-ai.manus.space`, remove the trailing `studyscribe-ai` portion from the Name field to prevent a duplicated suffix. Do not change any Value field.

| Record | Cloudflare Name field if the zone is `manus.space` | Value — enter exactly | TTL | Priority | Conflict check |
|---|---|---|---|---|---|
| DKIM TXT | `resend._domainkey.studyscribe-ai` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDSZ7nraxw+cGt7Fn/fcm5zPiFt1s635JdeLWy0ezM9YvbZKyK/sd9WxAqLHIgLALbCCrHGn2B2YpO04OY2z6EDooeaG70lxHUuIlZNt86F/rZqnV2o5+GhfoITjP6vu1yb9sCBmVcYRLIGyrmQeYnTG34p06PczdXOOZ8tuJQDYwIDAQAB` | Auto | — | Look for an existing TXT/CNAME at this exact hostname. A duplicate DKIM selector is a conflict; do not overwrite it. |
| SPF MX | `send.studyscribe-ai` | `feedback-smtp.us-east-1.amazonses.com` | Auto | `10` | An MX record at this hostname can coexist with other MX records, but check whether another service already uses the `send` subdomain. |
| SPF TXT | `send.studyscribe-ai` | `v=spf1 include:amazonses.com ~all` | Auto | — | **Do not create a second SPF TXT record** at this hostname. If an SPF record already exists there, merge the `include:amazonses.com` mechanism into the existing single SPF policy rather than adding another one. |
| DMARC TXT | `_dmarc` | `v=DMARC1; p=none;` | Auto | — | Check for an existing `_dmarc` TXT record first. DMARC permits only one policy record; merge rather than duplicate it. |

## Step-by-step in Cloudflare

1. Sign in to [Cloudflare](https://dash.cloudflare.com/) and select the zone that actually controls the Resend domain. In **DNS → Records**, use the search box to check each host in the table before creating it. This identifies the conflicts described above.

2. Add the **DKIM** record. Select **Add record**, choose **TXT**, paste `resend._domainkey.studyscribe-ai` in **Name**, and paste the complete `p=MIGf...IDAQAB` string from the table into **Content** as one unbroken value. Leave **TTL** on **Auto**, then save. TXT records have no priority field and must remain DNS-only.

3. Add the **SPF MX** record. Select **Add record**, choose **MX**, set **Name** to `send.studyscribe-ai`, set **Mail server** to `feedback-smtp.us-east-1.amazonses.com`, select **Priority 10**, leave **TTL** on **Auto**, and save. Do not enable a proxy; MX records are DNS-only.

4. Add the **SPF TXT** record. Select **Add record**, choose **TXT**, set **Name** to `send.studyscribe-ai`, paste `v=spf1 include:amazonses.com ~all` in **Content**, leave **TTL** on **Auto**, and save. If Cloudflare already shows an SPF policy at the same name, stop and merge the values; two SPF TXT policies at one hostname can invalidate SPF evaluation.

5. Add the recommended **DMARC** record. Select **Add record**, choose **TXT**, set **Name** to `_dmarc`, paste `v=DMARC1; p=none;` in **Content**, leave **TTL** on **Auto**, and save. The `p=none` policy is monitoring-only; it asks receivers to report but not quarantine/reject messages.

6. Return to the Resend Domains page and select **Verify**. DNS propagation can be quick with Cloudflare but may still take time. Do not change a record’s name or value while verification is pending. Once verified, update the project sender identity to an address at the verified domain, and then retry the approved password-reset email test.

## What to send back before saving a potentially conflicting record

If any of these searches returns a record already in use, share only the **record type, name, and value** (do not share API keys or account credentials):

| Hostname to check | Why it matters |
|---|---|
| `resend._domainkey.studyscribe-ai` | A DKIM selector must not collide with another sender’s selector. |
| `send.studyscribe-ai` | SPF must be one combined TXT policy; MX use should be intentional. |
| `_dmarc` | A domain must have one DMARC policy record. |

## References

[1]: https://resend.com/docs/dashboard/domains/introduction "Resend — Verified Domains"
