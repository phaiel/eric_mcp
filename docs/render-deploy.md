# Deploy AnythingMCP to Render (Personal OS)

Configuration-only deploy: GitHub → Render → Claude Mobile. No custom app code.

## Architecture on Render

```
Claude Mobile  →  https://personal-os-mcp.onrender.com/mcp/{serverId}
                         │
              Next.js :PORT  (public — Render routes here)
                         │ rewrites /mcp, /api, /health
              NestJS :4000  (internal only)
                         │
              Render Postgres
```

AnythingMCP already proxies backend routes through Next.js (`next.config.ts` rewrites). One web service, one public URL — same pattern as the official Railway template.

---

## Prerequisites

- GitHub account
- [Render](https://render.com) account
- This repo on GitHub (`home_niagara_mcp` or a fork)

### Repo layout

```
home_niagara_mcp/
├── render.yaml              ← Blueprint (this file)
├── docs/
└── anythingmcp/             ← AnythingMCP source (Docker build context)
```

**Important:** `anythingmcp/` must be part of the Git repo Render clones. If you cloned AnythingMCP as a nested git repo, either:

1. **Submodule** (cleanest for upstream updates):
   ```bash
   rm -rf anythingmcp
   git submodule add https://github.com/YOUR_USER/anythingmcp.git anythingmcp
   ```
   Fork [HelpCode-ai/anythingmcp](https://github.com/HelpCode-ai/anythingmcp) first if you need the `start.sh` Render patch from this project.

2. **Vendor** (simplest): delete `anythingmcp/.git` and commit the folder directly.

Never commit `anythingmcp/.env` — secrets go in Render env vars only.

---

## Step 1 — Push to GitHub

```bash
cd /path/to/home_niagara_mcp
git init
git add render.yaml docs/ anythingmcp/
git commit -m "Add AnythingMCP Render deploy config for Personal OS"
git branch -M main
git remote add origin git@github.com:YOUR_USER/home-niagara-mcp.git
git push -u origin main
```

---

## Step 2 — Deploy on Render

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect your GitHub repo
3. Render reads `render.yaml` and creates:
   - **personal-os-mcp** (web service, Docker)
   - **personal-os-db** (PostgreSQL)
4. Wait for first deploy (~5–10 min for Docker build)

### After deploy

1. Open `https://<your-service>.onrender.com` — register (first user = Admin)
2. Copy **MCP bearer token** from Render env (`MCP_BEARER_TOKEN`) for testing
3. MCP endpoint format: `https://<your-service>.onrender.com/mcp/<server-id>`
   - Find server ID in Dashboard → MCP Servers

### Verify URLs (if login/OAuth fails)

In Render → personal-os-mcp → Environment, confirm (or set manually):

| Variable | Value |
|----------|-------|
| `SERVER_URL` | `https://<your-service>.onrender.com` |
| `FRONTEND_URL` | same |
| `NEXTAUTH_URL` | same |
| `NEXT_PUBLIC_API_URL` | same |
| `CORS_ORIGIN` | same |

`start.sh` auto-sets these from `RENDER_EXTERNAL_URL` on boot. Override only if something is wrong.

---

## Step 3 — Reconnect connectors (fresh DB)

Render Postgres is **empty** — local connectors, KG edges, and OAuth tokens do not migrate.

1. **Notion** — Connectors → Notion → OAuth again
2. **Hevy** — re-enter API key
3. Re-assign connectors to your MCP server
4. Re-seed manual KG edges and skills (or import from notes)

Notion OAuth redirect uses `SERVER_URL` — must be the Render HTTPS URL before you connect.

---

## Step 4 — Connect Claude Mobile

1. Claude → Settings → Connectors → Add custom connector
2. URL: `https://<your-service>.onrender.com/mcp/<server-id>`
3. Auth: **OAuth** (requires `MCP_AUTH_MODE=both` or `oauth2` — set in `render.yaml`)
4. Complete OAuth in browser

For Claude Desktop (local), legacy bearer also works when `MCP_AUTH_MODE=both`:

```json
{
  "mcpServers": {
    "personal-os": {
      "url": "https://<your-service>.onrender.com/mcp/<server-id>",
      "headers": {
        "Authorization": "Bearer <MCP_BEARER_TOKEN from Render env>"
      }
    }
  }
}
```

---

## Step 5 — Enable KG

In AnythingMCP UI → Settings → Organization:

- `kg_capture_intent` → **on**
- `kg_edge_auto_apply` → **off**
- `skillAutoApply` → **off**

---

## Render notes

| Topic | Detail |
|-------|--------|
| **Free tier** | Web service spins down after ~15 min idle; first request is slow (cold start) |
| **Starter ($7/mo)** | Always on — recommended for Claude Mobile |
| **DB plan** | `basic-256mb` in blueprint; bump if you hit limits |
| **Secrets** | `render.yaml` uses `generateValue` for JWT, encryption, MCP tokens — copy from Render env after deploy |
| **Updates** | Push to `main` → auto-redeploy |

---

## What does not migrate from localhost

- User account (re-register; first user = admin)
- Connectors and credentials (re-auth)
- KG manual edges and skills (reconfigure)
- Notion data (unchanged — Notion is separate)
- Local Postgres data

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Health check fails | Check deploy logs; DB `DATABASE_URL` must be set |
| 502 on /mcp | Backend died — check logs; often DB connection or missing secrets |
| Notion OAuth fails | `SERVER_URL` must be `https://` Render URL, not localhost |
| Claude can't connect | Use OAuth mode; confirm `MCP_AUTH_MODE=both` or `oauth2` |
| Notion 404 on tools | Re-share Notion databases with the integration |

---

[Back to implementation plan](./personal-os-implementation-plan.md)
