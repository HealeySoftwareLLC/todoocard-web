# TodooCard Web

Flash pictures onto TodooCard / T3 six-colour e-paper cards straight from Chrome.
No app to install: the page talks to the card over **Web Bluetooth**, prepares the
image in the browser (crop, rotate, six-ink dithering, panel calibration) and
sends it with the card's verified-window transfer protocol. An optional small
backend lets you **search the web for images** and **generate images with AI**
using your own API keys.

> Unofficial project. TodooCard is a product of Sunbelife; this tool is not
> affiliated with or endorsed by them.

## Features

- **Pair and inspect** a card: model, serial, firmware, hardware revision, battery,
  bond state and (when the browser exposes advertisements) capability flags.
- **Upload** JPEG/PNG/WebP/GIF, drag-and-drop or paste. Images never leave the browser.
  EXIF orientation is honoured.
- **Editor**: fill or fit, rotate, zoom, pan, background colour, brightness,
  contrast and saturation, with a live preview of the dithered six-ink result and
  an ink-usage bar.
- **Search** images via Openverse or Wikimedia Commons (no key), Pexels, Unsplash,
  Pixabay, Google Programmable Search, Brave or SerpApi (your key).
- **Generate** images with OpenAI GPT Image (newest model your key can use, e.g.
  gpt-image-2.6-flare; gpt-image-1 was retired by OpenAI in October 2026), Stability AI,
  Google Imagen or Replicate (FLUX etc.), with the card's 2:3 aspect ratio.
- **Send** with progress, cancel, protocol log and the card's refresh acknowledgement
  as the only success signal.

## Requirements

- Chrome or Edge (desktop, Android, ChromeOS). Safari and Firefox do not implement Web Bluetooth.
- A secure origin: `https://` or `http://localhost`.
- On macOS, Chrome needs Bluetooth permission (System Settings → Privacy & Security → Bluetooth).
- A TodooCard / T3 528×792 card. Firmware v157 (0x9D) and newer is tested; older firmware uses the legacy path (untested).

## Quick start

```bash
# with Docker
docker run --rm -p 8787:8787 ghcr.io/brianhealey/todoocard-web:latest
# open http://localhost:8787

# or from source (Node 20+)
npm install
npm run dev        # web on :5173 (proxying /api), API on :8787
npm run build && npm start
```

Provider keys can be entered in **Settings** in the browser (stored in that browser's
localStorage and sent only inside the request that uses them) or configured server-side
through environment variables (see `.env.example`). When both exist, the browser key wins.

## Pairing the card

The card only accepts a new computer while its physical pairing window is open.

1. Find the button on the back. It is **flush and invisible**, under the surface near an edge; press firmly.
2. Hold it about 5 seconds until the front light flashes quickly. The window stays open for 60 seconds.
3. Click **Connect card**, pick the card in Chrome's chooser, and accept the system pairing prompt if one appears.
4. The app reads the encrypted Battery Level characteristic. Success means the bond exists; that is the same proof the vendor tooling uses. Once bonded, the card reconnects without the button.

A card that disconnects about a second after connecting is refusing an unbonded computer: reopen the window and try again.

## How it works

```
image ─▶ canvas 528×792 (fit/rotate/adjust) ─▶ Floyd–Steinberg to 6 inks ─▶ panel calibration
      ─▶ controller byte order ─▶ BLE: 01 (block size) · 02 (length+flags) · 03 (start)
      ─▶ 32-block windows on FEF2, Flash checkpoint acks on FEF1 ─▶ 05 08 refresh ack
```

- Inks: black 0, white 1, yellow 2, red 3, blue 5, green 6; two pixels per byte, high nibble first.
- Panel calibration for T3 is a vertical flip of the upright image, then the SE0368-class
  controller raster order. The unit tests check both bitmaps byte-for-byte against output of the
  vendor converter (`tests/fixtures`).
- Firmware v157+ accepts either a QuickLZ stream or the **raw controller bitmap**; this project
  sends the raw bitmap (about 15 % more bytes, no GPL compression code). Firmware before v157 gets
  the QuickLZ *stored-block* container, which is framing only.
- Transfers are windowed: at most 32 blocks, the last with a write-with-response, then wait up to
  5 s for the device's durable checkpoint. A lower index is a repair, not a restart. The display
  only counts as updated after the `05 08` acknowledgement. On v165+ the retained image-ACK
  diagnostics are read after a failure.

Web Bluetooth cannot read advertisements without a Chrome flag, so firmware is read from the
Device Information service (`0x2A26`, e.g. `0xBB` = v187) and the capability flags are shown only
when `watchAdvertisements()` is available.

## Backend API

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/config` | providers, which have server keys, whether an app token is required |
| `POST /api/search` | `{provider, query, page?, orientation?, keys?}` → normalised results |
| `POST /api/generate` | `{provider, prompt, aspect, keys?, options?}` → image bytes |
| `POST /api/models` | `{provider, keys?}` → image models the key can use (OpenAI), best first |
| `GET /api/image?url=` | CORS-free image fetch with SSRF protection (public hosts only, 25 MB, image types only) |

Environment variables: `PORT`, `APP_ACCESS_TOKEN` (when set, clients must send `X-App-Token`),
`ALLOW_CLIENT_KEYS` (default `true`), and per-provider keys: `PEXELS_API_KEY`,
`UNSPLASH_ACCESS_KEY`, `PIXABAY_API_KEY`, `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX`, `BRAVE_SEARCH_KEY`,
`SERPAPI_KEY`, `OPENAI_API_KEY`, `STABILITY_API_KEY`, `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`.
Requests are rate limited per client IP (search 60/min, generate 10/min, image 120/min).

Adding a provider is one file in `server/providers/search` or `server/providers/generate`
plus a line in `server/providers/index.ts`.

## Deployment

- `Dockerfile` builds a small multi-arch image; CI publishes `ghcr.io/brianhealey/todoocard-web` on every push to `main`.
- `deploy/k8s/` has a Deployment, Service and example Ingress. `deploy/cloudflared.md` explains exposing it through a Cloudflare Tunnel (Web Bluetooth needs https).
- `deploy/docker-compose.yml` for a single host.

Protect a public instance with `APP_ACCESS_TOKEN` or Cloudflare Access; otherwise anyone can use your server-side keys and image proxy.

## Development

```bash
npm run dev          # vite + tsx watch
npm test             # vitest: protocol parsing, pipeline, vendor parity
npm run typecheck
npm run fixtures     # regenerate tests/fixtures/upright.png (expected.*.bin come from the vendor converter)
```

Layout: `shared/` (protocol constants, image pipeline, payload builders: pure TS used by both sides),
`web/` (React + Vite app, Web Bluetooth client and transfer state machine in `web/src/lib`),
`server/` (Hono API and providers), `tests/`, `deploy/`.

## Known limitations

- No QuickLZ compression (raw bitmap on v157+, roughly 60–90 s per image over BLE).
- Pre-v157 firmware path is implemented from the documented behaviour but has not been run against a device.
- Capability flags (pairing window open, OTA recovery, Turbo Link) need `chrome://flags/#enable-experimental-web-platform-features` for advertisement access; without it the app relies on the device refusing unbonded links.
- HEIC input is not decodable by Chrome; convert first.

## Credits

Protocol behaviour was learned from Sunbelife's public
[TodooCard Skills](https://github.com/Sunbelife/TodooCard_Skills) macOS tooling and from
observing a v187 card. All code here is original and MIT licensed.
