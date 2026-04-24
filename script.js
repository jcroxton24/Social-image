(function () {
  'use strict';

  // ── STATE ─────────────────────────────────────────────────────
  const state = {
    img: null,
    imgX: 0,
    imgY: 0,
    imgW: 1080,
    imgH: 1350,
    watermarkVisible: true,
  };

  // ── ELEMENT REFS ──────────────────────────────────────────────
  const appCanvas      = document.getElementById('canvas');
  const wrapper        = document.getElementById('canvas-wrapper');
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
    const availW = wrapper.clientWidth  - 48;
    const availH = wrapper.clientHeight - 48;
    const scale  = Math.min(availW / 1080, availH / 1350, 1);
    currentScale = scale;

    const scaledW = 1080 * scale;
    const scaledH = 1350 * scale;
    const marginL = (wrapper.clientWidth  - scaledW) / 2;
    const marginT = (wrapper.clientHeight - scaledH) / 2;

    appCanvas.style.transform  = `scale(${scale})`;
    appCanvas.style.marginLeft = `${marginL}px`;
    appCanvas.style.marginTop  = `${marginT}px`;
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

  // ── HANDLE POSITIONING ────────────────────────────────────────
  function positionHandles() {
    const { imgX: x, imgY: y, imgW: w, imgH: h } = state;

    selBorder.style.left   = x + 'px';
    selBorder.style.top    = y + 'px';
    selBorder.style.width  = w + 'px';
    selBorder.style.height = h + 'px';

    const positions = {
      tl: [x,       y      ],
      tm: [x + w/2, y      ],
      tr: [x + w,   y      ],
      ml: [x,       y + h/2],
      mr: [x + w,   y + h/2],
      bl: [x,       y + h  ],
      bm: [x + w/2, y + h  ],
      br: [x + w,   y + h  ],
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
      state.img = img;
      // Cover-fit: fill the canvas, centred
      const scaleX = 1080 / img.naturalWidth;
      const scaleY = 1350 / img.naturalHeight;
      const fit    = Math.max(scaleX, scaleY);
      state.imgW = img.naturalWidth  * fit;
      state.imgH = img.naturalHeight * fit;
      state.imgX = (1080 - state.imgW) / 2;
      state.imgY = (1350 - state.imgH) / 2;
      drawImage();
      positionHandles();
      imageHandles.classList.remove('hidden');
    };
    img.src = url;
    // Reset so the same file can be re-selected
    fileInput.value = '';
  });

  // ── DRAG ──────────────────────────────────────────────────────
  let dragging  = false;
  let dragStart = {};

  appCanvas.addEventListener('mousedown', e => {
    // Only start drag if the click is on a layer (not a handle)
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
    const pt    = canvasPoint(e.clientX, e.clientY);
    state.imgX  = dragStart.imgX + (pt.x - dragStart.x);
    state.imgY  = dragStart.imgY + (pt.y - dragStart.y);
    drawImage();
    positionHandles();
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      appCanvas.style.cursor = '';
    }
    if (resizing) {
      resizing = false;
      resizeHandle = null;
    }
  });

  // ── RESIZE ────────────────────────────────────────────────────
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
      const pt     = canvasPoint(e.clientX, e.clientY);
      resizeStart  = {
        pt,
        imgX: state.imgX,
        imgY: state.imgY,
        imgW: state.imgW,
        imgH: state.imgH,
      };
    });
  });

  document.addEventListener('mousemove', e => {
    if (!resizing) return;
    const pt = canvasPoint(e.clientX, e.clientY);
    const dx = pt.x - resizeStart.pt.x;
    const dy = pt.y - resizeStart.pt.y;
    let { imgX, imgY, imgW, imgH } = resizeStart;
    const h = resizeHandle;

    if (h === 'tr' || h === 'mr' || h === 'br') {
      imgW = Math.max(MIN_SIZE, imgW + dx);
    }
    if (h === 'tl' || h === 'ml' || h === 'bl') {
      const newW = Math.max(MIN_SIZE, imgW - dx);
      imgX = imgX + imgW - newW;
      imgW = newW;
    }
    if (h === 'bl' || h === 'bm' || h === 'br') {
      imgH = Math.max(MIN_SIZE, imgH + dy);
    }
    if (h === 'tl' || h === 'tm' || h === 'tr') {
      const newH = Math.max(MIN_SIZE, imgH - dy);
      imgY = imgY + imgH - newH;
      imgH = newH;
    }

    state.imgX = imgX;
    state.imgY = imgY;
    state.imgW = imgW;
    state.imgH = imgH;
    drawImage();
    positionHandles();
  });

  // ── TEXT ──────────────────────────────────────────────────────
  headlineInput.addEventListener('input', () => {
    headlineDisplay.textContent = headlineInput.value;
  });

  // ── WATERMARK TOGGLE ──────────────────────────────────────────
  watermarkBtn.addEventListener('click', () => {
    state.watermarkVisible = !state.watermarkVisible;
    watermarkLayer.style.display = state.watermarkVisible ? '' : 'none';
    watermarkBtn.textContent     = state.watermarkVisible ? 'Hide Watermark' : 'Show Watermark';
  });

  // ── EXPORT ────────────────────────────────────────────────────
  exportBtn.addEventListener('click', async () => {
    exportBtn.textContent = 'Preparing…';
    exportBtn.disabled    = true;

    // Hide handles
    imageHandles.classList.add('hidden');

    // Remove scale transform so html2canvas captures at true 1080×1350
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

      const link      = document.createElement('a');
      link.download   = 'social-image.png';
      link.href       = output.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      // Restore visual state
      appCanvas.style.transform  = savedTransform;
      appCanvas.style.marginLeft = savedMarginLeft;
      appCanvas.style.marginTop  = savedMarginTop;

      if (state.img) imageHandles.classList.remove('hidden');

      exportBtn.textContent = 'Download Image';
      exportBtn.disabled    = false;
    }
  });

})();
