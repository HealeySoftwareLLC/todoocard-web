# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

A browser app that flashes images onto TodooCard / T3 six-colour e-paper cards over **Web
Bluetooth**, plus a small Node API that proxies image search and AI image generation with
user-supplied keys. Unofficial; TodooCard is a Sunbelife product. MIT licensed, so **never copy
code from the vendor's tooling** (their repo has no licence) and **do not add QuickLZ** (GPL).
Protocol behaviour may be learned from observation and documentation only.

## Layout

- `shared/` pure TypeScript used by both sides; no DOM, no Node APIs.
  - `protocol.ts` constants (UUIDs, firmware thresholds, commands, status codes), advertisement and
    control-message parsing, diagnostics parsing.
  - `image.ts` Floyd–Steinberg six-ink dithering, nibble packing, T3 panel calibration
    (vertical flip), controller raster order.
  - `payload.ts` raw payload for v157+, QuickLZ *stored-block* container (framing only) for older firmware.
- `web/` Vite + React 18 + TypeScript. `web/src/lib/ble.ts` is the Web Bluetooth client
  (`TodooCardClient`), `web/src/lib/transfer.ts` the transfer state machine, `compose.ts` canvas
  composition, `api.ts` + `settings.ts` the backend client and localStorage settings.
- `server/` Hono on Node 22: `index.ts` routes, `proxy.ts` SSRF-guarded image fetch, `keys.ts`
  key resolution (client keys first, env second), `ratelimit.ts`, `providers/{search,generate}/*`.
- `tests/` vitest. `tests/fixtures/expected*.bin` were produced by the vendor converter from
  `upright.png`; `image.test.ts` requires byte-identical output. Do not regenerate the expected
  files without that converter; do not "fix" a parity failure by editing the fixture.
- `deploy/` Dockerfile companions: k8s manifests, docker-compose, Cloudflare Tunnel notes.

## Commands

```bash
npm run dev          # vite :5173 (proxies /api) + tsx watch server :8787
npm test             # vitest (protocol parsing, pipeline, vendor parity)
npm run typecheck    # both tsconfigs (web: Bundler resolution, server: NodeNext)
npm run build        # dist/web + dist/server; `npm start` serves both on :8787
docker build -t todoocard-web .   # image runs as numeric USER 100:101
```

Shared modules import siblings with a `.js` extension (`./protocol.js`) so they compile under
NodeNext; keep that convention.

## Protocol facts (verified on firmware v187, card model T3)

- Manufacturer data company id `0x5053`, screen type `0x134C`; flags bit 0x01 encrypted GATT,
  0x02 pairing window open, 0x08 OTA recovery (refuse sends), 0x10 Turbo Link.
- Web Bluetooth has no advertisement access without a Chrome flag, so firmware comes from Device
  Information `0x2A26` (string like `0xBB` = v187) and flags appear only if `watchAdvertisements()` exists.
- Pairing proof is a successful read of the **encrypted Battery Level (180F/2A19)**; the OS creates
  the bond then. The card drops unbonded centrals within ~1 s unless its physical pairing window is
  open (hidden flush rear button held ~5 s, 60 s window).
- Control FEF1: `01` → `01 <blockSize> 00`; `02 <len u32le> <flags>` → `02 00`; `03` starts; device
  sends `05 00 <index u32le>` block requests / checkpoints; `05 08` = refresh done; `05 01/09/0A` =
  errors. Data FEF2: `<index u32le> + payload` (blockSize − 4 bytes, 240 in practice).
- v157+ (`0x9D`): windows of 32 blocks, last write with response, wait ≤5 s for the checkpoint, lower
  index = repair, max 16 repairs; success only on `05 08`. Flags `0x03` = raw controller bitmap
  (what we send), `0x01` = QuickLZ container.
- Chrome allows one GATT operation at a time per device: route everything through
  `TodooCardClient.op()`. Pass real `ArrayBuffer`s to `writeValue*` (TS 5.7 BufferSource typing).
- A v187 card transferred 872 blocks in ~9 s from Chrome; it disconnects after `05 08` while it
  redraws, so a post-send disconnect is expected.

## Backend rules

- `/api/*` requires `X-App-Token` when `APP_ACCESS_TOKEN` is set, **except `/api/health`** (probes).
- Keys: client keys in the request body win when `ALLOW_CLIENT_KEYS` is true; otherwise env.
  Never log or persist keys.
- `/api/image` must stay SSRF-safe: http(s) only, public addresses only (DNS-resolved), manual
  redirects re-checked, 25 MB cap, image content types only.
- Adding a provider: one file in `server/providers/search` or `generate` implementing
  `SearchProvider`/`GenerateProvider` plus registration in `server/providers/index.ts`. Declare
  `fields` (secret flag, optional) and `env` names; the UI renders them automatically.
- Openverse anonymous API caps `page_size` at 20.

## Deployment

- CI (`.github/workflows/ci.yml`) runs typecheck/test/build and publishes multi-arch
  `ghcr.io/brianhealey/todoocard-web` with tags `latest`, `main`, `sha-<7>`.
- Brian's instance: cluster-iac repo, `cluster-manifests/apps/todoocard-web` (pinned `sha-` tag,
  bump to roll) behind `apps/cloudflared`; public https://todoo.hee-hee.net, LAN
  https://cards.homelab.local. Pods run with `runAsNonRoot`; the image user must stay numeric.

## Testing against a real card

Web Bluetooth's device chooser is a native dialog the user must click. Build, run `npm run dev`,
and ask the user to click Connect; verify with the in-app log (enable debug in Settings). Never
send to a card without the user's explicit go-ahead: it replaces the display.
