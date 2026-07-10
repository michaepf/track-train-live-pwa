# Local Authenticated Testing

## Current laptop setup

This laptop already has a private Tailscale Serve route configured:

```text
https://msi.tail79a005.ts.net/ -> http://127.0.0.1:5173
```

The route is available only inside the tailnet. It uses Tailscale Serve, not the publicly accessible Tailscale Funnel. Do not run `tailscale serve reset`; the existing route should be preserved.

The Vite configuration already allows `.ts.net` hosts.

## Start the app

From the repository root:

```powershell
npm run dev -- --host 127.0.0.1
```

Then open the private HTTPS URL from a device connected to the same tailnet:

```text
https://msi.tail79a005.ts.net
```

HTTPS is required because the OpenRouter PKCE flow uses `crypto.subtle` to derive its challenge. The callback URL is generated from the current browser origin, so OpenRouter returns to the Tailscale HTTPS URL automatically.

IndexedDB and the stored OpenRouter key are origin-specific. The Tailscale URL has separate local data from `localhost` and the production deployment, and therefore requires its own one-time OpenRouter login. Never copy or expose the resulting API key.

## Inspect the route

Tailscale's Windows local API requires administrator access on this machine. These commands are read-only but may need an elevated shell:

```powershell
tailscale status
tailscale serve status
```

Expected Serve status:

```text
https://msi.tail79a005.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:5173
```

Stopping Vite is sufficient when testing is finished. The persistent private Serve route can remain configured.

## Tool-operation manual smoke tests

Use the requirements in `docs/TOOL-OPERATION-STATUS-REQUIREMENTS.md` as the source of truth. The short authenticated smoke-test loop is:

1. Ask for and accept a workout proposal.
2. Ask the trainer to edit a planned workout.
3. Trigger a safe no-change operation.
4. Interrupt a response and verify that recovery is understandable.
5. Confirm that running, success, and failure language is readable on mobile.

Partial writes, stale references, and other difficult-to-induce failures belong in deterministic automated tests rather than this manual loop.
