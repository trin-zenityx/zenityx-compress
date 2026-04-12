# Cloudflare CLI setup (laptop-side)

## Tools installed

- **`wrangler`** (npm v4.81.1) — official Cloudflare CLI for Workers, Pages, R2, D1, KV
- **`flarectl`** (brew v0.116.0) — Cloudflare CLI with dedicated DNS record management

## API token

Scoped API token stored in **macOS Keychain** (service name: `cf-api-token`):

- Permissions: `Zone:DNS:Edit` + `Zone:Zone:Read` on `zenityx.com`
- Not a Global API Key — cannot touch Workers, billing, or other zones

### Retrieve the token manually

```bash
security find-generic-password -a "$USER" -s "cf-api-token" -w
```

### Replace the token (e.g. after rotation)

```bash
security add-generic-password -U -a "$USER" -s "cf-api-token" -w "<NEW_TOKEN>"
```

## `cf-env` helper

`~/.local/bin/cf-env` loads the token from Keychain and exports it as both:

- `CF_API_TOKEN` (for `flarectl`)
- `CLOUDFLARE_API_TOKEN` (for `wrangler`)

### Usage in an interactive shell

```bash
source cf-env
flarectl zone list
wrangler whoami
```

### Usage in a one-off command (eval pipe)

```bash
eval "$(cf-env)" && flarectl dns list --zone zenityx.com
```

### Automatic load on shell start (optional)

Add to `~/.zshrc`:

```bash
# Auto-load Cloudflare token on shell start
[ -f "$HOME/.local/bin/cf-env" ] && source "$HOME/.local/bin/cf-env" 2>/dev/null
```

## Common DNS record operations

### List all DNS records in zenityx.com

```bash
source cf-env
flarectl dns list --zone zenityx.com
```

### Create / update an A record

```bash
flarectl dns create-or-update \
  --zone zenityx.com \
  --name <subdomain> \
  --type A \
  --content <ipv4> \
  --ttl 300 \
  --proxy=false
```

Example (what we used for compress.zenityx.com):

```bash
flarectl dns create-or-update \
  --zone zenityx.com \
  --name compress \
  --type A \
  --content <YOUR_VPS_IP> \
  --ttl 300 \
  --proxy=false
```

### Delete a DNS record

```bash
# Get the record ID from list, then:
flarectl dns delete --zone zenityx.com --id <record-id>
```

### Show zone info

```bash
flarectl zone info --zone zenityx.com
```

## Wrangler (for future Workers / Pages)

`wrangler` uses `CLOUDFLARE_API_TOKEN`, which `cf-env` already exports. Verify:

```bash
source cf-env
wrangler whoami
```

If you later need a wider-scope token for Workers deployment, create a separate token with `Workers Scripts:Edit` + `Zone:DNS:Edit` and store it under a different keychain service name (e.g. `cf-workers-token`), then adapt `cf-env` to load the right one.

## Security notes

- The current `cf-api-token` allows DNS edits on `zenityx.com` only. If it leaks, the blast radius is DNS record tampering on that zone — nothing wider.
- **Rotate the token** anytime at https://dash.cloudflare.com/profile/api-tokens — Roll → copy new value → `security add-generic-password -U ...`.
- Never commit the raw token to git. The Keychain is the single source of truth.
