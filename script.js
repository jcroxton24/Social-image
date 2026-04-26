(function () {
  'use strict';

  // ── STATE ─────────────────────────────────────────────────────
  const state = {
    img: null,
    imgX: 0,
    imgY: 0,
    imgW: 1080,
    imgH: 1350,
    imgAspect: 1,
    watermarkVisible: true,
  };

  // ── ELEMENT REFS ──────────────────────────────────────────────
  const appCanvas        = document.getElementById('canvas');
  const wrapper          = document.getElementById('canvas-wrapper');
  const canvasSpacer     = document.getElementById('canvas-spacer');
  const scaleIndicator   = document.getElementById('scale-indicator');
  const imageGhost       = document.getElementById('image-ghost');
  const imageCanvas      = document.getElementById('image-layer');
  const imageHandles     = document.getElementById('image-handles');
  const selBorder        = document.getElementById('selection-border');
  const headlineInput    = document.getElementById('headline-input');
  const headlineDisplay  = document.getElementById('headline-display');
  const uploadBtn        = document.getElementById('upload-btn');
  const fileInput        = document.getElementById('file-input');
  const urlInput         = document.getElementById('url-input');
  const urlBtn           = document.getElementById('url-btn');
  const removeBtn        = document.getElementById('remove-btn');
  const undoBtn          = document.getElementById('undo-btn');
  const watermarkToggle  = document.getElementById('watermark-toggle');
  const watermarkLayer   = document.getElementById('watermark-layer');
  const exportBtn        = document.getElementById('export-btn');
  const qualityToast     = document.getElementById('quality-toast');

  const ctx = imageCanvas.getContext('2d');
  imageCanvas.width  = 1080;
  imageCanvas.height = 1350;

  // ── CANVAS SCALING ────────────────────────────────────────────
  // The canvas is position:absolute inside the wrapper.
  // JS sets left/top directly — no flex centering involved, so there
  // is no conflict between the layout box (1080×1350) and the visual
  // scaled size. The spacer gives the wrapper its correct scroll height.
  let currentScale = 1;
  const BORDER = 48;

  function scaleCanvas() {
    const scale = Math.min(
      (wrapper.clientWidth  - BORDER * 2) / 1080,
      (wrapper.clientHeight - BORDER * 2) / 1350,
      1
    );
    currentScale = scale;

    const scaledW = 1080 * scale;
    const scaledH = 1350 * scale;
    const left    = (wrapper.clientWidth  - scaledW) / 2;
    const top     = (wrapper.clientHeight - scaledH) / 2;

    appCanvas.style.transform = `scale(${scale})`;
    appCanvas.style.left      = `${left}px`;
    appCanvas.style.top       = `${top}px`;

    // Spacer sets the wrapper's scroll dimensions so the canvas + borders
    // are always reachable if the viewport is unusually small.
    canvasSpacer.style.width  = `${wrapper.clientWidth}px`;
    canvasSpacer.style.height = `${top + scaledH + BORDER}px`;

    scaleIndicator.textContent = Math.round(scale * 100) + '%';
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
    updateGhost();
  }

  // Positions the ghost <img> to match the current image state.
  // The ghost is inside #canvas (overflow:visible) and shows the
  // portions of the image that fall outside the 1080×1350 frame.
  function updateGhost() {
    if (!state.img) return;
    imageGhost.style.left   = state.imgX + 'px';
    imageGhost.style.top    = state.imgY + 'px';
    imageGhost.style.width  = state.imgW + 'px';
    imageGhost.style.height = state.imgH + 'px';
  }

  // ── QUALITY WARNING TOAST ─────────────────────────────────────
  let toastTimer = null;
  function showQualityWarning(img) {
    if (img.naturalWidth >= 1080 && img.naturalHeight >= 1350) return;
    clearTimeout(toastTimer);
    qualityToast.textContent =
      `This image is ${img.naturalWidth}×${img.naturalHeight}px — smaller than ` +
      `1080×1350 and may appear blurry when exported.`;
    qualityToast.classList.add('visible');
    toastTimer = setTimeout(() => qualityToast.classList.remove('visible'), 5000);
  }

  // ── THROTTLED REDRAW (RAF) ────────────────────────────────────
  // Coalesces rapid mousemove/touchmove redraws to one per animation frame.
  let rafId = null;
  function scheduleRedraw() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      drawImage();
      positionHandles();
    });
  }

  // ── HANDLE POSITIONING ────────────────────────────────────────
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

  // ── UNDO STACK ────────────────────────────────────────────────
  const MAX_UNDO = 50;
  const undoStack = [];
  let opSnapshot = null; // saved at drag/resize start; committed only if state changed

  function snapshotState() {
    return {
      img:       state.img,
      imgX:      state.imgX,
      imgY:      state.imgY,
      imgW:      state.imgW,
      imgH:      state.imgH,
      imgAspect: state.imgAspect,
    };
  }

  // Push unconditionally — for applyImage / remove where state always changes
  function pushUndo() {
    undoStack.push(snapshotState());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    undoBtn.disabled = false;
  }

  // Save a snapshot at the start of a drag/resize operation
  function beginOp() {
    opSnapshot = snapshotState();
  }

  // Commit the snapshot only if the operation actually changed state
  function commitOp() {
    if (!opSnapshot) return;
    const s = opSnapshot;
    opSnapshot = null;
    if (
      s.imgX !== state.imgX || s.imgY !== state.imgY ||
      s.imgW !== state.imgW || s.imgH !== state.imgH ||
      s.img  !== state.img
    ) {
      undoStack.push(s);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      undoBtn.disabled = false;
    }
  }

  function undo() {
    if (!undoStack.length) return;
    const prev = undoStack.pop();
    state.img       = prev.img;
    state.imgX      = prev.imgX;
    state.imgY      = prev.imgY;
    state.imgW      = prev.imgW;
    state.imgH      = prev.imgH;
    state.imgAspect = prev.imgAspect;
    if (state.img) {
      imageGhost.src           = state.img.src;
      imageGhost.style.display = 'block';
      removeBtn.style.display  = '';
      drawImage();
      positionHandles();
      imageHandles.classList.remove('hidden');
    } else {
      ctx.clearRect(0, 0, 1080, 1350);
      imageGhost.src           = '';
      imageGhost.style.display = 'none';
      imageHandles.classList.add('hidden');
      removeBtn.style.display  = 'none';
    }
    undoBtn.disabled = undoStack.length === 0;
  }

  undoBtn.addEventListener('click', undo);

  // ── APPLY IMAGE (shared by all load paths) ────────────────────
  function applyImage(img) {
    pushUndo();

    state.img       = img;
    state.imgAspect = img.naturalWidth / img.naturalHeight;

    const fit  = Math.max(1080 / img.naturalWidth, 1350 / img.naturalHeight);
    state.imgW = img.naturalWidth  * fit;
    state.imgH = img.naturalHeight * fit;
    state.imgX = (1080 - state.imgW) / 2;
    state.imgY = (1350 - state.imgH) / 2;

    imageGhost.src           = img.src;
    imageGhost.style.display = 'block';
    removeBtn.style.display  = '';

    drawImage();
    positionHandles();
    imageHandles.classList.remove('hidden');
    showQualityWarning(img);
  }

  // ── FILE UPLOAD ───────────────────────────────────────────────
  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => applyImage(img);
    img.src    = url;
    fileInput.value = '';
  });

  // ── PASTE FROM CLIPBOARD ──────────────────────────────────────
  document.addEventListener('paste', e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => applyImage(img);
        img.src = url;
        break;
      }
    }
  });

  // ── URL UPLOAD ────────────────────────────────────────────────
  urlBtn.addEventListener('click', () => loadFromUrl());
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadFromUrl(); });

  function loadFromUrl() {
    const url = urlInput.value.trim();
    if (!url) return;

    urlBtn.textContent = 'Loading…';
    urlBtn.disabled    = true;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      applyImage(img);
      urlInput.value     = '';
      urlBtn.textContent = 'Load';
      urlBtn.disabled    = false;
    };

    img.onerror = () => {
      urlBtn.textContent = 'Load';
      urlBtn.disabled    = false;
      alert(
        'Could not load the image from that URL.\n\n' +
        'The server may not allow cross-origin requests. ' +
        'Try downloading the image and uploading it from your computer instead.'
      );
    };

    img.src = url;
  }

  // ── REMOVE IMAGE ─────────────────────────────────────────────
  removeBtn.addEventListener('click', () => {
    pushUndo();
    state.img = null;
    ctx.clearRect(0, 0, 1080, 1350);
    imageGhost.src           = '';
    imageGhost.style.display = 'none';
    imageHandles.classList.add('hidden');
    removeBtn.style.display  = 'none';
  });

  // ── DRAG ──────────────────────────────────────────────────────
  let dragging   = false;
  let dragStart  = {};
  let pinching   = false;
  let pinchStart = {};

  function startDrag(clientX, clientY) {
    if (!state.img) return false;
    const pt = canvasPoint(clientX, clientY);
    if (
      pt.x >= state.imgX && pt.x <= state.imgX + state.imgW &&
      pt.y >= state.imgY && pt.y <= state.imgY + state.imgH
    ) {
      dragging  = true;
      dragStart = { x: pt.x, y: pt.y, imgX: state.imgX, imgY: state.imgY };
      beginOp();
      return true;
    }
    return false;
  }

  function moveDrag(clientX, clientY) {
    const pt   = canvasPoint(clientX, clientY);
    state.imgX = dragStart.imgX + (pt.x - dragStart.x);
    state.imgY = dragStart.imgY + (pt.y - dragStart.y);
    scheduleRedraw();
  }

  function applyResize(clientX, clientY) {
    const pt     = canvasPoint(clientX, clientY);
    const aspect = state.imgAspect;
    const { imgX, imgY, imgW, imgH } = resizeStart;
    let newX = imgX, newY = imgY, newW, newH;

    if (resizeHandle === 'br') {
      newW = Math.max(MIN_SIZE, Math.min(MAX_SIZE, pt.x - imgX));
      newH = newW / aspect;
      newX = imgX;
      newY = imgY;
    } else if (resizeHandle === 'bl') {
      newW = Math.max(MIN_SIZE, Math.min(MAX_SIZE, (imgX + imgW) - pt.x));
      newH = newW / aspect;
      newX = (imgX + imgW) - newW;
      newY = imgY;
    } else if (resizeHandle === 'tr') {
      newW = Math.max(MIN_SIZE, Math.min(MAX_SIZE, pt.x - imgX));
      newH = newW / aspect;
      newX = imgX;
      newY = (imgY + imgH) - newH;
    } else {
      newW = Math.max(MIN_SIZE, Math.min(MAX_SIZE, (imgX + imgW) - pt.x));
      newH = newW / aspect;
      newX = (imgX + imgW) - newW;
      newY = (imgY + imgH) - newH;
    }

    state.imgX = newX;
    state.imgY = newY;
    state.imgW = newW;
    state.imgH = newH;
    scheduleRedraw();
  }

  // Mouse drag
  appCanvas.addEventListener('mousedown', e => {
    if (e.target.classList.contains('handle')) return;
    if (startDrag(e.clientX, e.clientY)) {
      appCanvas.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', e => {
    if (dragging) moveDrag(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      appCanvas.style.cursor = '';
      commitOp();
    }
    if (resizing) {
      resizing = false;
      commitOp();
    }
    resizeHandle = null;
  });

  // Touch drag + pinch resize
  function pinchDist(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  appCanvas.addEventListener('touchstart', e => {
    if (e.touches.length === 2 && state.img) {
      dragging = false;
      pinching = true;
      beginOp();
      e.preventDefault();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const mid = canvasPoint(mx, my);
      pinchStart = {
        dist: pinchDist(e.touches),
        imgX: state.imgX, imgY: state.imgY,
        imgW: state.imgW, imgH: state.imgH,
        relX: (mid.x - state.imgX) / state.imgW,
        relY: (mid.y - state.imgY) / state.imgH,
      };
    } else if (e.touches.length === 1) {
      if (e.target.classList.contains('handle')) return;
      if (startDrag(e.touches[0].clientX, e.touches[0].clientY)) {
        e.preventDefault();
      }
    }
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!dragging && !resizing && !pinching) return;
    e.preventDefault();
    if (pinching && e.touches.length === 2) {
      const scale = pinchDist(e.touches) / pinchStart.dist;
      const newW  = Math.max(MIN_SIZE, Math.min(MAX_SIZE, pinchStart.imgW * scale));
      const newH  = newW / state.imgAspect;
      const mx    = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my    = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const mid   = canvasPoint(mx, my);
      state.imgW  = newW;
      state.imgH  = newH;
      state.imgX  = mid.x - pinchStart.relX * newW;
      state.imgY  = mid.y - pinchStart.relY * newH;
      scheduleRedraw();
    } else {
      const t = e.touches[0];
      if (dragging) moveDrag(t.clientX, t.clientY);
      if (resizing) applyResize(t.clientX, t.clientY);
    }
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (e.touches.length === 0) {
      if (dragging || resizing || pinching) commitOp();
      dragging = false; resizing = false; resizeHandle = null; pinching = false;
    } else if (e.touches.length === 1 && pinching) {
      commitOp();
      pinching = false;
    }
  });

  // ── PROPORTIONAL RESIZE ───────────────────────────────────────
  let resizing     = false;
  let resizeHandle = null;
  let resizeStart  = {};
  const MIN_SIZE   = 80;
  const MAX_SIZE   = 5400; // 5× canvas width — prevents OOM on extreme resize

  document.querySelectorAll('.handle').forEach(handle => {
    function beginResize(e) {
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
      beginOp();
    }
    handle.addEventListener('mousedown', beginResize);
    handle.addEventListener('touchstart', beginResize, { passive: false });
  });

  document.addEventListener('mousemove', e => {
    if (!resizing) return;
    applyResize(e.clientX, e.clientY);
  });

  // ── KEYBOARD SHORTCUTS ────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
  });

  // ── TEXT ──────────────────────────────────────────────────────
  headlineInput.addEventListener('input', () => {
    headlineDisplay.textContent = headlineInput.value;
  });

  // ── WATERMARK TOGGLES ─────────────────────────────────────────
  watermarkToggle.addEventListener('change', () => {
    state.watermarkVisible       = watermarkToggle.checked;
    watermarkLayer.style.display = watermarkToggle.checked ? '' : 'none';
  });

  const watermark2Layer  = document.getElementById('watermark2-layer');
  const watermark2Toggle = document.getElementById('watermark2-toggle');
  watermark2Toggle.addEventListener('change', () => {
    watermark2Layer.style.display = watermark2Toggle.checked ? 'block' : 'none';
  });

  const watermark3Layer  = document.getElementById('watermark3-layer');
  const watermark3Toggle = document.getElementById('watermark3-toggle');
  watermark3Toggle.addEventListener('change', () => {
    watermark3Layer.style.display = watermark3Toggle.checked ? 'block' : 'none';
  });

  // ── MOBILE BOTTOM SHEET ───────────────────────────────────────
  const mobileOpenBtn  = document.getElementById('mobile-open-btn');
  const sheetBackdrop  = document.getElementById('sheet-backdrop');
  const controlsPanel  = document.getElementById('controls');
  const sheetHandle    = document.getElementById('sheet-handle');

  function openSheet()  { controlsPanel.classList.add('open');    sheetBackdrop.classList.add('open'); }
  function closeSheet() { controlsPanel.classList.remove('open'); sheetBackdrop.classList.remove('open'); }

  mobileOpenBtn.addEventListener('click', openSheet);
  mobileOpenBtn.addEventListener('touchend', e => { e.preventDefault(); openSheet(); });
  sheetBackdrop.addEventListener('click', closeSheet);
  sheetHandle.addEventListener('click', closeSheet);
  sheetHandle.addEventListener('touchend', e => { e.preventDefault(); closeSheet(); });

  // ── DATA URL → BLOB ───────────────────────────────────────────
  function dataUrlToBlob(dataUrl) {
    const [header, b64] = dataUrl.split(',');
    const mime  = header.match(/:(.*?);/)[1];
    const bytes = atob(b64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // ── PNG DPI INJECTION ─────────────────────────────────────────
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
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const src    = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) src[i] = binary.charCodeAt(i);

    const ppm  = Math.round(dpi / 0.0254);
    const type = new Uint8Array([0x70, 0x48, 0x59, 0x73]);
    const data = new Uint8Array(9);
    data[0] = (ppm >>> 24) & 0xFF;
    data[1] = (ppm >>> 16) & 0xFF;
    data[2] = (ppm >>>  8) & 0xFF;
    data[3] = (ppm       ) & 0xFF;
    data[4] = data[0]; data[5] = data[1]; data[6] = data[2]; data[7] = data[3];
    data[8] = 1;

    const crcInput = new Uint8Array(13);
    crcInput.set(type, 0);
    crcInput.set(data, 4);
    const crcVal = crc32(crcInput);

    const chunk = new Uint8Array(21);
    chunk[3] = 9;
    chunk.set(type, 4);
    chunk.set(data, 8);
    chunk[17] = (crcVal >>> 24) & 0xFF;
    chunk[18] = (crcVal >>> 16) & 0xFF;
    chunk[19] = (crcVal >>>  8) & 0xFF;
    chunk[20] = (crcVal       ) & 0xFF;

    const insertAt = 33;
    const out = new Uint8Array(src.length + chunk.length);
    out.set(src.slice(0, insertAt), 0);
    out.set(chunk, insertAt);
    out.set(src.slice(insertAt), insertAt + chunk.length);

    let s = '';
    for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
    return 'data:image/png;base64,' + btoa(s);
  }

  // ── EXPORT ────────────────────────────────────────────────────
  exportBtn.addEventListener('click', async () => {
    exportBtn.textContent = 'Preparing…';
    exportBtn.disabled    = true;
    imageHandles.classList.add('hidden');

    const savedTransform = appCanvas.style.transform;
    const savedLeft      = appCanvas.style.left;
    const savedTop       = appCanvas.style.top;
    appCanvas.style.transform = 'none';
    appCanvas.style.left      = '0';
    appCanvas.style.top       = '0';

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

      const rawDataUrl = output.toDataURL('image/png');
      const dpiDataUrl = writePngDpi(rawDataUrl, 200);
      const blob       = dataUrlToBlob(dpiDataUrl);

      // Try Web Share API on mobile (works after await; shows native save sheet).
      // Fall back to blob URL download on any failure or on desktop.
      let saved = false;
      if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare) {
        const file = new File([blob], 'social-image.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
            saved = true;
          } catch (shareErr) {
            if (shareErr.name === 'AbortError') saved = true; // user cancelled — fine
            // any other error: fall through to blob URL download below
          }
        }
      }

      if (!saved) {
        const blobUrl = URL.createObjectURL(blob);
        const link    = document.createElement('a');
        link.download = 'social-image.png';
        link.href     = blobUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      appCanvas.style.transform = savedTransform;
      appCanvas.style.left      = savedLeft;
      appCanvas.style.top       = savedTop;

      if (state.img) imageHandles.classList.remove('hidden');

      exportBtn.textContent = 'Download Image';
      exportBtn.disabled    = false;
    }
  });

}());
