# PixelRevive ✨ // On-Device ESRGAN Super-Resolution

<p align="center">
  <img src="https://raw.githubusercontent.com/sunisethereal-dot/pixelrevive/main/screenshot.png" alt="PixelRevive Screenshot" width="100%" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=for-the-badge" alt="Apache 2.0 License" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.17-brightgreen.svg?style=for-the-badge&logo=node.js" alt="Node.js Version" /></a>
  <a href="https://npmjs.com/package/@qvac/sdk"><img src="https://img.shields.io/badge/QVAC%20SDK-v0.19.1-purple.svg?style=for-the-badge&logo=npm" alt="QVAC SDK Version" /></a>
  <a href="#"><img src="https://img.shields.io/badge/On--Device%20AI-Real--ESRGAN%204x-sky.svg?style=for-the-badge" alt="On-Device AI" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Cloud%20Data%20Egress-0.00%20KB%20(Air--Gapped)-emerald.svg?style=for-the-badge" alt="Zero Cloud Data Egress" /></a>
</p>

---

## 🌟 Overview

**PixelRevive** is a lightweight, on-device AI super-resolution tool built with Tether's open-source **QVAC SDK** (`@qvac/sdk`). It restores and upscales low-resolution `.jpg` and `.png` images by 4x using Real-ESRGAN running entirely in local memory—no server dependencies, no API keys, and zero cloud telemetry.

- ⚡ **100% On-Device AI:** Runs locally on your laptop or workstation via CPU/GPU.
- 🖼️ **Interactive Before/After Slider:** Visualizes fine restored textures side-by-side in real-time.
- 📦 **Compact Footprint:** Single model download (~65 MB) via QVAC's distributed model registry.
- 🛡️ **Air-Gapped Privacy:** Your photos and images never leave your machine.

---

## 📋 QVAC SDK Functions & Specifications Table

| Metric / Item | Specification | Details |
| :--- | :--- | :--- |
| **SDK Package** | `@qvac/sdk` | Verified `0.19.1` via `npm list @qvac/sdk` |
| **Model ID / Constant** | `REALESRGAN_X4PLUS` | `RealESRGAN_x4plus.pth` (~67.0 MB) |
| **Model Type** | `"diffusion"` | Standalone upscaler mode |
| **Model Config** | `{ mode: "upscale", upscaler: { tile_size: 128 } }` | `tile_size: 128` prevents CPU memory spikes |
| **Primary SDK Functions** | `loadModel()`, `upscale()`, `unloadModel()` | Verified exports directly from SDK API |
| **Cloud Telemetry** | `0.00 KB` | Pure local memory execution |

---

## ⚡ Prerequisites

- **Node.js**: `>= 22.17.0` (Verify with `node -v`)
- **npm**: `>= 10.9.0`
- **Operating System**: Windows 10/11 x64, macOS, or Linux

---

## 🚀 Installation & Quickstart

### 1. Clone the Repository
```bash
git clone https://github.com/sunisethereal-dot/pixelrevive.git
cd pixelrevive
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Verify SDK Version
```bash
npm list @qvac/sdk
```
*Output: `@qvac/sdk@0.19.1`*

### 4. Run the Upscaler (CLI + Web UI)

Set the config environment variable and run:
```powershell
$env:QVAC_CONFIG_PATH="./qvac.config.json"; node src/index.js
```

*(On Linux / macOS: `QVAC_CONFIG_PATH="./qvac.config.json" node src/index.js`)*

> [!NOTE]
> The first run downloads the Real-ESRGAN weights (~65 MB). Subsequent runs execute instantly from local cache!

### 5. Open the Interactive Comparison Slider
Open your browser to:
👉 **`http://127.0.0.1:3000`**

Drag the slider to compare the original low-res image against the 4x ESRGAN super-resolution output!

### 6. Run Pure CLI Mode on Custom Images
```bash
node src/index.js path/to/your-photo.jpg
```
The enhanced result will be saved to `outputs/upscaled.png`.

---

## 🧠 QVAC SDK Integration Details

PixelRevive follows the standard QVAC lifecycle:

```javascript
import fs from 'node:fs';
import { loadModel, upscale, unloadModel, REALESRGAN_X4PLUS } from '@qvac/sdk';

// 1. Load Real-ESRGAN standalone model
const modelId = await loadModel({
  modelSrc: REALESRGAN_X4PLUS,
  modelType: "diffusion",
  modelConfig: {
    mode: "upscale",
    upscaler: { tile_size: 128 }
  },
  onProgress: (p) => console.log(`Downloading: ${p.percentage}%`)
});

// 2. Read image buffer and run 4x super-resolution
const imageBytes = fs.readFileSync('sample.jpg');
const { outputs, stats } = upscale({
  modelId,
  image: imageBytes,
  repeats: 1
});

const [upscaledBuffer] = await outputs;
fs.writeFileSync('outputs/upscaled.png', upscaledBuffer);

// 3. Unload model to release VRAM/RAM
await unloadModel({ modelId });
```

---

## 📄 License

Licensed under the **Apache License, Version 2.0**. See [`LICENSE`](LICENSE) for complete terms.
