// PNG → Arduboy converter: threshold any image to 1-bit, import it into the
// project as tiles or a sprite, or emit a PROGMEM C array (the same format
// as the community image converters: vertical bytes, LSB on top).

import { el } from './ui.js';
import { makeTile, makeSprite, blankPixels, setPixel, pixelsToBytes, MAX_TILES, MAX_SPRITES } from './model.js';
import { bitmapToCArray } from './codegen.js';

export function initImageTool(app) {
  const fileInput = document.getElementById('imgFile');
  const threshold = document.getElementById('imgThreshold');
  const invert = document.getElementById('imgInvert');
  const preview = document.getElementById('imgPreview');
  const output = document.getElementById('imgCArray');
  const headerChk = document.getElementById('imgHeader');

  let img = null;      // HTMLImageElement
  let pixels = null;   // row strings
  let w = 0, h = 0;

  function process() {
    if (!img) return;
    w = Math.min(img.naturalWidth, 128);
    h = Math.min(img.naturalHeight, 64);
    const work = document.createElement('canvas');
    work.width = w; work.height = h;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.drawImage(img, 0, 0, w, h);
    const data = wctx.getImageData(0, 0, w, h).data;
    const thr = parseInt(threshold.value, 10);
    const inv = invert.checked;
    pixels = blankPixels(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        const opaque = data[i + 3] > 127;
        let on = opaque && lum >= thr;
        if (inv) on = opaque && !on;
        setPixel(pixels, x, y, on);
      }
    }
    const scale = Math.max(2, Math.min(6, Math.floor(512 / w)));
    preview.width = w * scale;
    preview.height = h * scale;
    const ctx = preview.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0e13';
    ctx.fillRect(0, 0, preview.width, preview.height);
    ctx.fillStyle = '#d8ecff';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixels[y][x] === '#') ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    updateCArray();
  }

  function updateCArray() {
    if (!pixels) return;
    const bytes = pixelsToBytes(pixels, w, h);
    output.value = bitmapToCArray('image', bytes, w, h, headerChk.checked);
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    img = new Image();
    img.onload = () => { process(); URL.revokeObjectURL(url); };
    img.src = url;
  });
  threshold.addEventListener('input', process);
  invert.addEventListener('change', process);
  headerChk.addEventListener('change', updateCArray);

  document.getElementById('imgCopyC').addEventListener('click', async () => {
    if (!output.value) return;
    try { await navigator.clipboard.writeText(output.value); } catch { output.select(); document.execCommand('copy'); }
  });

  document.getElementById('imgImportTiles').addEventListener('click', () => {
    if (!pixels) { alert('Load an image first'); return; }
    const cols = Math.floor(w / 8), rows = Math.floor(h / 8);
    if (!cols || !rows) { alert('Image must be at least 8x8'); return; }
    let added = 0;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        if (app.project.tiles.length >= MAX_TILES) break;
        const slice = [];
        for (let y = 0; y < 8; y++) slice.push(pixels[ty * 8 + y].slice(tx * 8, tx * 8 + 8));
        if (slice.every((r) => r === '........')) continue; // skip blank slices
        app.project.tiles.push(makeTile(`Imported ${tx},${ty}`, slice));
        added++;
      }
    }
    app.save();
    alert(`Imported ${added} tile${added === 1 ? '' : 's'} (blank 8x8 slices skipped). See the Tiles tab.`);
  });

  document.getElementById('imgImportSprite').addEventListener('click', () => {
    if (!pixels) { alert('Load an image first'); return; }
    if (app.project.sprites.length >= MAX_SPRITES) { alert(`Max ${MAX_SPRITES} sprites`); return; }
    const sw = Math.min(w, 16), sh = Math.min(h, 16);
    const slice = [];
    for (let y = 0; y < sh; y++) slice.push(pixels[y].slice(0, sw));
    // pad to a supported size
    const tw = sw > 8 ? 16 : 8, th = sh > 8 ? 16 : 8;
    const padded = blankPixels(tw, th);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) setPixel(padded, x, y, slice[y][x] === '#');
    }
    app.project.sprites.push(makeSprite('Imported sprite', [padded], tw, th));
    app.save();
    alert(`Imported as ${tw}x${th} sprite (top-left of the image). See the Sprites tab.`);
  });

  return { refresh: () => {} };
}
