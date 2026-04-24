(function () {
  'use strict';

  // ── STATE ─────────────────────────────────────────────────────
  const state = {
    img: null,
    imgX: 0,
    imgY: 0,
    imgW: 1080,
    imgH: 1350,
    imgAspect: 1,     // naturalWidth / naturalHeight, locked on upload
    watermarkVisible: true,
  };

  // ── ELEMENT REFS ──────────────────────────────────────────────
  const appCanvas       = document.getElementById('canvas');
  const wrapper         = document.getElementById('canvas-wrapper');
  const scaleIndicator  = document.getElementById('scale-indicator');
  const imageCanvas    = document.getElementById('image-layer');
  const imageHandles   = document.getElementById('image-handles');
  const selBorder      = document.getElementById('selection-border');
  const headlineInput  = document.getElementById('headline-input');
  const headlineDisplay= document.getElementById('headline-display');
  const uploadBtn      = document.getElementById('upload-btn');
  const fileInput      = document.getElementById('file-input');
  const watermarkBtn   = document.getElementById('watermark-btn');
  const watermarkLayer = document.getElementById('watermark-layer');
  const exportBtn      = document.getElementById('export-btn');

  const ctx = imageCanvas.getContext('2d');
  imageCanvas.width  = 1080;
  imageCanvas.height = 1350;

  // ── CANVAS SCALING ────────────────────────────────────────────
  let currentScale = 1;

  function scaleCanvas() {
    // Always keep at least BORDER px of visible checkerboard on every side
    const BORDER = 48;
    const scale  = Math.min(
      (wrapper.clientWidth  - BORDER * 2) / 1080,
      (wrapper.clientHeight - BORDER * 2) / 1350,
      1
    );
    currentScale = scale;

    const scaledW = 1080 * scale;
    const scaledH = 1350 * scale;
    const marginL = (wrapper.clientWidth  - scaledW) / 2;
    const marginT = (wrapper.clientHeight - scaledH) / 2;

    appCanvas.style.transform  = `scale(${scale})`;
    appCanvas.style.marginLeft = `${marginL}px`;
    appCanvas.style.marginTop  = `${marginT}px`;

    scaleIndicator.textContent = Math.round(scale * 100) + '% of full size';
  }

  window.addEventListener('resize', scaleCanvas);
  scaleCanvas();

  // ── CANVAS-SPACE COORDINATES ──────────────────────────────────
  function canvasPoint(clientX, clientY) {
    const rect = appCanvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / currentScale,
      y: (clientY - rect.top)  / currentScale,
    };
  }

  // ── IMAGE DRAW ────────────────────────────────────────────────
  function drawImage() {
    ctx.clearRect(0, 0, 1080, 1350);
    if (state.img) {
      ctx.drawImage(state.img, state.imgX, state.imgY, state.imgW, state.imgH);
    }
  }

  // ── HANDLE POSITIONING (corners only) ────────────────────────
  function positionHandles() {
    const { imgX: x, imgY: y, imgW: w, imgH: h } = state;

    selBorder.style.left   = x + 'px';
    selBorder.style.top    = y + 'px';
    selBorder.style.width  = w + 'px';
    selBorder.style.height = h + 'px';

    const positions = {
      tl: [x,     y    ],
      tr: [x + w, y    ],
      bl: [x,     y + h],
      br: [x + w, y + h],
    };

    document.querySelectorAll('.handle').forEach(handle => {
      const [hx, hy] = positions[handle.dataset.handle];
      handle.style.left = hx + 'px';
      handle.style.top  = hy + 'px';
    });
  }

  // ── IMAGE UPLOAD ──────────────────────────────────────────────
  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      state.img       = img;
      state.imgAspect = img.naturalWidth / img.naturalHeight;

      // Cover-fit: fill the canvas, centred
      const fit    = Math.max(1080 / img.naturalWidth, 1350 / img.naturalHeight);
      state.imgW   = img.naturalWidth  * fit;
      state.imgH   = img.naturalHeight * fit;
      state.imgX   = (1080 - state.imgW) / 2;
      state.imgY   = (1350 - state.imgH) / 2;

      drawImage();
      positionHandles();
      imageHandles.classList.remove('hidden');
    };
    img.src = url;
    fileInput.value = '';
  });

  // ── DRAG ──────────────────────────────────────────────────────
  let dragging  = false;
  let dragStart = {};

  appCanvas.addEventListener('mousedown', e => {
    if (e.target.classList.contains('handle')) return;
    if (!state.img) return;

    const pt = canvasPoint(e.clientX, e.clientY);
    if (
      pt.x >= state.imgX && pt.x <= state.imgX + state.imgW &&
      pt.y >= state.imgY && pt.y <= state.imgY + state.imgH
    ) {
      dragging = true;
      appCanvas.style.cursor = 'grabbing';
      dragStart = { x: pt.x, y: pt.y, imgX: state.imgX, imgY: state.imgY };
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const pt   = canvasPoint(e.clientX, e.clientY);
    state.imgX = dragStart.imgX + (pt.x - dragStart.x);
    state.imgY = dragStart.imgY + (pt.y - dragStart.y);
    drawImage();
    positionHandles();
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      appCanvas.style.cursor = '';
    }
    resizing     = false;
    resizeHandle = null;
  });

  // ── PROPORTIONAL RESIZE (corner handles, locked aspect ratio) ─
  let resizing     = false;
  let resizeHandle = null;
  let resizeStart  = {};
  const MIN_SIZE   = 80;

  document.querySelectorAll('.handle').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      resizing     = true;
      resizeHandle = handle.dataset.handle;
      resizeStart  = {
        imgX: state.imgX,
        imgY: state.imgY,
        imgW: state.imgW,
        imgH: state.imgH,
      };
    });
  });

  document.addEventListener('mousemove', e => {
    if (!resizing) return;
    const pt     = canvasPoint(e.clientX, e.clientY);
    const aspect = state.imgAspect;
    const { imgX, imgY, imgW, imgH } = resizeStart;
    let newX = imgX, newY = imgY, newW, newH;

    // Each corner scales from the diagonally opposite (fixed) corner.
    // Width is the primary axis; height follows the locked aspect ratio.
    if (resizeHandle === 'br') {
      newW = Math.max(MIN_SIZE, pt.x - imgX);
      newH = newW / aspect;
      newX = imgX;
      newY = imgY;
    } else if (resizeHandle === 'bl') {
      newW = Math.max(MIN_SIZE, (imgX + imgW) - pt.x);
      newH = newW / aspect;
      newX = (imgX + imgW) - newW;
      newY = imgY;
    } else if (resizeHandle === 'tr') {
      newW = Math.max(MIN_SIZE, pt.x - imgX);
      newH = newW / aspect;
      newX = imgX;
      newY = (imgY + imgH) - newH;
    } else { // tl
      newW = Math.max(MIN_SIZE, (imgX + imgW) - pt.x);
      newH = newW / aspect;
      newX = (imgX + imgW) - newW;
      newY = (imgY + imgH) - newH;
    }

    state.imgX = newX;
    state.imgY = newY;
    state.imgW = newW;
    state.imgH = newH;
    drawImage();
    positionHandles();
  });

  // ── TEXT ──────────────────────────────────────────────────────
  headlineInput.addEventListener('input', () => {
    headlineDisplay.textContent = headlineInput.value;
  });

  // ── WATERMARK TOGGLE ──────────────────────────────────────────
  watermarkBtn.addEventListener('click', () => {
    state.watermarkVisible        = !state.watermarkVisible;
    watermarkLayer.style.display  = state.watermarkVisible ? '' : 'none';
    watermarkBtn.textContent      = state.watermarkVisible ? 'Hide Watermark' : 'Show Watermark';
  });

  // ── PNG DPI INJECTION ─────────────────────────────────────────
  // Builds and inserts a pHYs chunk into a PNG data URL so the
  // exported file carries the correct pixel density metadata.

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c;
    }
    return t;
  }());

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function writePngDpi(dataUrl, dpi) {
    // Decode base64 PNG
    const base64  = dataUrl.split(',')[1];
    const binary  = atob(base64);
    const src     = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) src[i] = binary.charCodeAt(i);

    // Build pHYs chunk data (pixels per metre, unit = 1)
    // 200 ppi × (1 / 0.0254 m per inch) = 7874 pixels/metre
    const ppm  = Math.round(dpi / 0.0254);
    const type = new Uint8Array([0x70, 0x48, 0x59, 0x73]); // "pHYs"
    const data = new Uint8Array(9);
    // Pixels per unit X and Y (big-endian uint32)
    data[0] = (ppm >>> 24) & 0xFF;
    data[1] = (ppm >>> 16) & 0xFF;
    data[2] = (ppm >>>  8) & 0xFF;
    data[3] = (ppm       ) & 0xFF;
    data[4] = data[0]; data[5] = data[1]; data[6] = data[2]; data[7] = data[3];
    data[8] = 1; // unit: metre

    // CRC covers type + data (13 bytes)
    const crcInput = new Uint8Array(13);
    crcInput.set(type, 0);
    crcInput.set(data, 4);
    const crcVal = crc32(crcInput);

    // Full chunk: length(4) + type(4) + data(9) + crc(4) = 21 bytes
    const chunk = new Uint8Array(21);
    chunk[3] = 9; // data length = 9 (big-endian, high bytes stay 0)
    chunk.set(type, 4);
    chunk.set(data, 8);
    chunk[17] = (crcVal >>> 24) & 0xFF;
    chunk[18] = (crcVal >>> 16) & 0xFF;
    chunk[19] = (crcVal >>>  8) & 0xFF;
    chunk[20] = (crcVal       ) & 0xFF;

    // Insert after the IHDR chunk which always ends at byte 33
    // (8 sig + 4 len + 4 type + 13 data + 4 crc = 33)
    const insertAt = 33;
    const out = new Uint8Array(src.length + chunk.length);
    out.set(src.slice(0, insertAt), 0);
    out.set(chunk, insertAt);
    out.set(src.slice(insertAt), insertAt + chunk.length);

    // Re-encode as base64 data URL
    let s = '';
    for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
    return 'data:image/png;base64,' + btoa(s);
  }

  // ── EXPORT ────────────────────────────────────────────────────
  exportBtn.addEventListener('click', async () => {
    exportBtn.textContent = 'Preparing…';
    exportBtn.disabled    = true;

    imageHandles.classList.add('hidden');

    // Strip scale transform so html2canvas captures at full 1080×1350
    const savedTransform  = appCanvas.style.transform;
    const savedMarginLeft = appCanvas.style.marginLeft;
    const savedMarginTop  = appCanvas.style.marginTop;
    appCanvas.style.transform  = 'none';
    appCanvas.style.marginLeft = '0';
    appCanvas.style.marginTop  = '0';

    try {
      await document.fonts.ready;

      const output = await html2canvas(appCanvas, {
        width:           1080,
        height:          1350,
        scale:           1,
        useCORS:         true,
        allowTaint:      false,
        logging:         false,
        backgroundColor: '#111111',
        imageTimeout:    0,
      });

      // Inject 200ppi DPI metadata into the PNG
      const rawDataUrl = output.toDataURL('image/png');
      const dpiDataUrl = writePngDpi(rawDataUrl, 200);

      const link    = document.createElement('a');
      link.download = 'social-image.png';
      link.href     = dpiDataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      appCanvas.style.transform  = savedTransform;
      appCanvas.style.marginLeft = savedMarginLeft;
      appCanvas.style.marginTop  = savedMarginTop;

      if (state.img) imageHandles.classList.remove('hidden');

      exportBtn.textContent = 'Download Image';
      exportBtn.disabled    = false;
    }
  });

}());
