# PixelRevive — Submission

## Repo URL
`https://github.com/sunisethereal-dot/pixelrevive`

## X Post URL
`https://x.com/<YOUR-HANDLE>/status/<POST-ID>`
> Replace with your public X post URL after posting. Must be public and include repo link + `@qvac`.

## What (1-2 lines + QVAC functions)
PixelRevive is an offline photo upscaler that restores old / low-res photos 100% on-device.
QVAC functions used: `loadModel` (loads local upscaler weights once at startup) + `upscale` (runs enhancement on-device, no upload).

## Why
Old family photos deserve a second life without uploading private images to the cloud — PixelRevive keeps everything local, works wifi-off, and is free to reuse.

## QVAC SDK
- SDK: `@qvac/sdk`
- SDK version: `0.19.1` (pinned in `package.json`, verify with `npm list @qvac/sdk`)
- Functions called in code: `loadModel`, `upscale` (`unloadModel` for cleanup, see `src/index.js`)
- Offline proof: airplane-mode / wifi-off run, no `fetch(` to external API in `src/`

## How to Run Offline
1. `npm install`
2. `npm start`
3. Disconnect wifi / enable airplane mode
4. Upload a photo from `samples/` → click Run → verify `100% on-device` badge + output in `outputs/`

## X Post Template (<280 chars, must include repo link + @qvac)
Copy-paste ready. Verified 166 chars with repo URL:

```text
Built PixelRevive with @qvac - offline photo upscaler 100% on-device via upscale! No upload, wifi-off. Repo: https://github.com/sunisethereal-dot/pixelrevive #LocalAI
```

Character count: 166 chars with `https://github.com/sunisethereal-dot/pixelrevive` (well under 280).

Alternative (159 chars):
```text
PixelRevive + @qvac = offline photo upscaler via loadModel + upscale. 100% on-device, wifi-off. Repo: https://github.com/sunisethereal-dot/pixelrevive #LocalAI
```

Requirements check for X post:
- [ ] Includes `@qvac`
- [ ] Includes repo link `https://github.com/sunisethereal-dot/pixelrevive`
- [ ] Mentions `upscale` / offline / wifi-off
- [ ] <280 chars
- [ ] Public post, URL pasted above

## Screenshot Checklist (required for review)
- [ ] 1. Terminal screenshot showing `100%` / `on-device` log during `upscale` (wifi-off visible if possible)
- [ ] 2. Before/after comparison (original from `samples/` vs upscaled from `outputs/`, same image, visible quality gain)
- [ ] 3. Wifi-off / airplane-mode badge visible (OS tray + app `wifi-off` / `100% on-device` badge in UI in same shot)
- [ ] 4. (Recommended) SDK version proof: `package.json` snippet or terminal `npm list @qvac/sdk` showing exact version
- [ ] All images attached to submission / in `public/` or linked from README, filenames clear (e.g. `terminal-100pct.png`, `before-after.png`, `wifi-off.png`)

## Inspiration Disclosure
Inspired by QVAC submission format (no code copied). All code in `src/` is original for PixelRevive.
