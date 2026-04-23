# Remote-control opencode from your phone (over Tailscale)

`opencode tailscale` exposes the opencode web UI on your tailnet so you can
drive a session from any device that's signed into the same Tailscale
account — phone, tablet, second laptop. WireGuard handles NAT traversal,
Tailscale issues the TLS cert, and there are no pairing codes, no relay
to host, and nothing exposed to the public internet.

## Setup

1. Install Tailscale on the laptop running opencode and on your phone:
   <https://tailscale.com/download>.
2. Sign both devices into the same tailnet (`tailscale up` on the
   laptop, the Tailscale app on the phone).
3. From the repo on your laptop, run:

   ```
   opencode tailscale
   ```

   You'll see something like:

   ```
   Tailnet:    mycorp.ts.net
   Device:     pine-laptop
   Signed in:  alex@mycorp.com
   Open on any tailnet device:
     http://pine-laptop.mycorp.ts.net:4096/
   ```

4. Open that URL in your phone's browser. The standard opencode web UI
   loads — pick or create a session and start chatting.

## HTTPS

Some browser features (clipboard write, install-as-PWA, secure-context
APIs) require HTTPS. Tailscale can issue a Let's Encrypt cert for your
device's MagicDNS name:

```
opencode tailscale --tls
```

The first run shells out to `tailscale cert` and caches the result
under `~/.opencode/data/tls/<host>/`. You may need to enable HTTPS for
your tailnet first under **Tailscale Admin → DNS → HTTPS Certificates**.

## Auth

By default, anyone signed into your tailnet who knows the URL can drive
the session. For personal tailnets that's just your own devices. For
shared tailnets, set a second factor:

```
OPENCODE_SERVER_PASSWORD=$(openssl rand -hex 16) opencode tailscale
```

The phone browser will prompt for the password on first load.

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--port <n>` | `4096` | TCP port to bind. |
| `--hostname <ip>` | this device's Tailscale IP | Bind hostname. Default keeps the server tailnet-only; pass `0.0.0.0` to also expose it on non-tailnet interfaces. |
| `--tls` | `false` | Fetch a Tailscale-issued cert and serve HTTPS. |
| `--cors <origin>` | `[]` | Repeatable. Allow extra origins (only relevant if you embed the UI elsewhere). |

## Why not a relay?

The first cut of this feature shipped a custom WebSocket relay with
pairing codes. Tailscale gives all of that for free (NAT traversal,
identity, valid TLS, MagicDNS) plus end-to-end WireGuard encryption.
For anyone already on Tailscale, this is strictly better; the relay
code lived on this branch briefly and was reverted in commits
`b56e441` + `ee7ecc6`.

If you don't run Tailscale and don't want to, the same UI is available
via `opencode serve` over a Cloudflare Tunnel or ngrok URL — same
mobile-friendly web UI, you just BYO transport.
