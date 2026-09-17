# Samples

Drop your own low-res test image here as `low-res.jpg`:

```
samples/low-res.jpg
```

Then run:

```bash
npm start samples/low-res.jpg
# output -> outputs/high-res.jpg
```

Notes:

- Do NOT commit large binaries (`*.jpg`, `*.png`, `outputs/`) to git — keep this folder lightweight.
- `samples/low-res.jpg` and `outputs/*` should be gitignored.
- Use a small (<1 MB) JPG for quick local testing.
- Screenshot in root `README.md` references this file as a placeholder until you add your own before/after comparison.
