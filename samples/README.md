# Samples

Drop your own low-res test image here as `low-res.jpg`:

```
samples/low-res.jpg
```

Then run:

```bash
npm start -- samples/low-res.jpg
# output -> outputs/upscaled.png
```

Notes:

- Do NOT commit large binaries (`*.jpg`, `*.png`, `outputs/`) to git — keep this folder lightweight.
- `outputs/*.png` and `outputs/*.jpg` are gitignored (see `.gitignore`); `samples/low-res.jpg` is tracked as a lightweight test asset.
- Use a small (<1 MB) JPG for quick local testing.
- Root `README.md` shows `screenshot.png`; replace it with your own before/after comparison when ready.
