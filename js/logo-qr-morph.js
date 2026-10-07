/*
 * LogoQRMorph: a voxel (cube-built) logo that morphs into a scannable QR code.
 * Needs the globals THREE (r128) and qrcode (qrcode-generator 1.4.x).
 *
 *   const morph = new LogoQRMorph(document.getElementById('stage'), { onStateChange, onStatus });
 *   morph.setLogoEmoji('💮');
 *   morph.setQR('https://example.com');
 *   morph.toggle();
 */
(function () {
  'use strict';

  const SPAN = 10;                  // world-space width of the logo and the QR code
  const LOGO_RES = 44;              // logo is sampled on a LOGO_RES x LOGO_RES grid
  const OUTLINE = 0.045;            // outline thickness (world units, each side)
  const MAX_QR_CUBES_PER_SIDE = 140; // caps sub-cube density on big QR codes
  const MAX_R = SPAN / Math.SQRT2;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- colour helpers ----------
  const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const toSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const luminance = c => 0.2126 * toLin(c.r) + 0.7152 * toLin(c.g) + 0.0722 * toLin(c.b);
  const copyRGB = c => ({ r: c.r, g: c.g, b: c.b });

  // Scale toward black until luminance <= maxL (keeps the hue).
  function darkenTo(c, maxL) {
    const L = luminance(c);
    if (L <= maxL) return copyRGB(c);
    const k = maxL / L;
    return { r: toSrgb(toLin(c.r) * k), g: toSrgb(toLin(c.g) * k), b: toSrgb(toLin(c.b) * k) };
  }
  // Mix toward white until luminance >= minL.
  function lightenTo(c, minL) {
    const L = luminance(c);
    if (L >= minL) return copyRGB(c);
    const s = (minL - L) / (1 - L);
    const f = v => toSrgb(toLin(v) + (1 - toLin(v)) * s);
    return { r: f(c.r), g: f(c.g), b: f(c.b) };
  }

  // ---------- logo → voxels ----------
  function voxelsFromCanvas(src, removeBg) {
    const G = LOGO_RES;
    const c = document.createElement('canvas');
    c.width = c.height = G;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, G, G);
    const d = ctx.getImageData(0, 0, G, G).data;

    let bg = null;
    if (removeBg && d[3] > 200) bg = [d[0], d[1], d[2]]; // opaque corner → treat as background

    const filled = new Uint8Array(G * G);
    for (let i = 0; i < G * G; i++) {
      const p = i * 4;
      if (d[p + 3] < 110) continue;
      if (bg && Math.hypot(d[p] - bg[0], d[p + 1] - bg[1], d[p + 2] - bg[2]) < 48) continue;
      filled[i] = 1;
    }

    // Distance to nearest edge → "puffy" depth so it reads as 3D when tilted.
    const dist = new Int16Array(G * G).fill(-1);
    const queue = [];
    for (let i = 0; i < G * G; i++) if (!filled[i]) { dist[i] = 0; queue.push(i); }
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const i = y * G + x;
      if (filled[i] && (x === 0 || y === 0 || x === G - 1 || y === G - 1) && dist[i] < 0) { dist[i] = 1; queue.push(i); }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % G, y = (i / G) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const j = ny * G + nx;
        if (dist[j] < 0) { dist[j] = dist[i] + 1; queue.push(j); }
      }
    }

    const cell = SPAN / G;
    const out = [];
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const i = y * G + x;
      if (!filled[i]) continue;
      const p = i * 4;
      const v = {
        x: (x - G / 2 + 0.5) * cell,
        y: -(y - G / 2 + 0.5) * cell,
        sx: cell * 0.94, sy: cell * 0.94, sz: cell * (0.6 + 1.1 * Math.sqrt(dist[i])),
        r: d[p] / 255, g: d[p + 1] / 255, b: d[p + 2] / 255,
      };
      v.lum = luminance(v);
      out.push(v);
    }
    return out;
  }

  function emojiVoxels(text) {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${S * 0.82}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(text, S / 2, S / 2 + S * 0.04);
    return voxelsFromCanvas(c, false);
  }

  function imageVoxels(img) {
    // Fit image into a square, preserving aspect ratio.
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const w = img.naturalWidth || img.width || S, h = img.naturalHeight || img.height || S;
    const k = (S * 0.92) / Math.max(w, h);
    ctx.drawImage(img, (S - w * k) / 2, (S - h * k) / 2, w * k, h * k);
    // Sample the corner of the original image to detect a solid background.
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const pctx = probe.getContext('2d');
    pctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
    const corner = pctx.getImageData(0, 0, 1, 1).data;
    if (corner[3] > 200) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = `rgb(${corner[0]},${corner[1]},${corner[2]})`;
      ctx.fillRect(0, 0, S, S);
    }
    return voxelsFromCanvas(c, true);
  }

  // ---------- QR → voxels ----------
  // density: each module becomes density x density sub-cubes (capped on big codes).
  // fill: also put cubes on the light modules, not just the dark ones.
  function qrVoxels(text, ecLevel, density, fill) {
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    }
    const q = qrcode(0, ecLevel);
    q.addData(text);
    q.make(); // throws if the text doesn't fit
    const n = q.getModuleCount();
    const k = Math.max(1, Math.min(density, Math.floor(MAX_QR_CUBES_PER_SIDE / n)));
    const cell = SPAN / n, sub = cell / k;
    const gap = k > 1 ? 0.9 : 1; // visible seams between sub-cubes
    const dark = [], light = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const isDark = q.isDark(r, c);
      if (!isDark && !fill) continue;
      const list = isDark ? dark : light;
      const sz = isDark ? cell * 0.6 : cell * 0.25; // dark modules stand proud
      for (let sy = 0; sy < k; sy++) for (let sx = 0; sx < k; sx++) {
        list.push({
          x: (c + (sx + 0.5) / k - n / 2) * cell,
          y: -(r + (sy + 0.5) / k - n / 2) * cell,
          sx: sub * gap, sy: sub * gap, sz, dark: isDark,
        });
      }
    }
    return { dark, light, n, cell, k, requestedK: density, version: (n - 17) / 4 };
  }

  // ---------- transition styles ----------
  // Each style: duration (s), maxDelay (fraction of the run used for stagger),
  // delay(it) → 0..1 stagger order, place(it, t) writes P/Q/S and returns how
  // far the colour has blended from logo to QR (0..1).
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const bounce = t => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  };
  const lerpScale = (a, b, t, k = 1) =>
    S.set(lerp(a.sx, b.sx, t) * k, lerp(a.sy, b.sy, t) * k, lerp(a.sz, b.sz, t) * k);
  let dropHeight = SPAN * 2; // set per frame so "drop" cubes leave the top of the view

  const STYLES = {
    classic: {
      label: 'Classic (arc + spin)',
      duration: 1.8, maxDelay: 0.4,
      delay: it => Math.min(1, Math.hypot(it.a.x, it.a.y) / MAX_R) * 0.875 + it.r1 * 0.125,
      place(it, t) {
        const e = ease(t), bump = Math.sin(Math.PI * e);
        P.set(lerp(it.a.x, it.b.x, e), lerp(it.a.y, it.b.y, e), bump * (1.5 + it.r2 * 3.5));
        Q.setFromAxisAngle(it.axis, bump * it.dir * (Math.PI + it.r3 * Math.PI));
        lerpScale(it.a, it.b, e);
        return e;
      },
    },
    swirl: {
      label: 'Swirl',
      duration: 1.8, maxDelay: 0.35,
      delay: it => Math.min(1, Math.hypot(it.a.x, it.a.y) / MAX_R) * 0.85 + it.r1 * 0.15,
      place(it, t) {
        const e = ease(t), bump = Math.sin(Math.PI * e);
        const x = lerp(it.a.x, it.b.x, e), y = lerp(it.a.y, it.b.y, e);
        const ang = bump * it.dir * 1.2, c = Math.cos(ang), s = Math.sin(ang);
        P.set(x * c - y * s, x * s + y * c, bump * (1.5 + it.r2 * 3.5));
        Q.setFromAxisAngle(it.axis, bump * it.dir * (Math.PI + it.r3 * Math.PI));
        lerpScale(it.a, it.b, e);
        return e;
      },
    },
    explode: {
      label: 'Explode',
      duration: 2.0, maxDelay: 0.15,
      delay: it => it.r1,
      place(it, t) {
        const e = ease(t), k = Math.sin(Math.PI * e);
        P.set(lerp(it.a.x, it.b.x, e) + it.ox * k, lerp(it.a.y, it.b.y, e) + it.oy * k, it.oz * k);
        Q.setFromAxisAngle(it.axis, e * Math.PI * 4 * it.dir); // whole turns → lands square
        lerpScale(it.a, it.b, e);
        return e;
      },
    },
    wave: {
      label: 'Wave (flip sweep)',
      duration: 2.0, maxDelay: 0.5,
      delay: it => (it.b.x / SPAN + 0.5) * 0.9 + it.r1 * 0.1, // sweeps left → right
      place(it, t) {
        const e = ease(t), bump = Math.sin(Math.PI * e);
        P.set(lerp(it.a.x, it.b.x, e), lerp(it.a.y, it.b.y, e), bump * 4);
        Q.setFromAxisAngle(Y_AXIS, e * Math.PI * 2); // card flip
        lerpScale(it.a, it.b, e);
        return e;
      },
    },
    drop: {
      label: 'Drop (rain + bounce)',
      duration: 2.4, maxDelay: 0.45,
      delay: it => (it.b.y / SPAN + 0.5) * 0.85 + it.r1 * 0.15, // bottom rows land first
      place(it, t) {
        Q.identity();
        if (t < 0.35) { // fly up out of view
          const u = t / 0.35;
          P.set(it.a.x, it.a.y + dropHeight * u * u, 0);
          lerpScale(it.a, it.a, 0);
          return 0;
        }
        const u = (t - 0.35) / 0.65; // rain down into place
        P.set(it.b.x, it.b.y + dropHeight * (1 - bounce(u)), 0);
        lerpScale(it.b, it.b, 0);
        return 1;
      },
    },
    dissolve: {
      label: 'Dissolve',
      duration: 1.4, maxDelay: 0.6,
      delay: it => it.r1,
      place(it, t) {
        Q.identity();
        if (t < 0.5) {
          P.set(it.a.x, it.a.y, 0);
          lerpScale(it.a, it.a, 0, 1 - ease(t * 2));
          return 0;
        }
        P.set(it.b.x, it.b.y, 0);
        lerpScale(it.b, it.b, 0, ease((t - 0.5) * 2));
        return 1;
      },
    },
  };

  const brightness = c => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;

  // Brightness of each colour relative to the palette it belongs to (0 = the
  // darkest colour present, 1 = the brightest). A one-colour palette is all 0.
  function relativeBrightness(colors) {
    let lo = Infinity, hi = -Infinity;
    const b = colors.map(c => { const v = brightness(c); lo = Math.min(lo, v); hi = Math.max(hi, v); return v; });
    const range = hi - lo;
    return b.map(v => range < 0.02 ? 0 : (v - lo) / range);
  }

  const PAGE_OUTLINE = new THREE.Color('#f5f5f7'); // light line against a dark page
  const CARD_OUTLINE = new THREE.Color('#111114'); // dark line against the white card

  class LogoQRMorph {
    constructor(container, options = {}) {
      this.container = container;
      this.opts = Object.assign({
        style: 'classic',
        outline: 'off',          // 'off' | 'auto' | 'custom'
        outlineColor: '#ff7aa8',
        card: false,             // white backing card behind the QR
        fill: false,             // cubes on light modules too
        density: 1,              // sub-cubes per module side
        quietZone: 1,            // white card margin around the QR, in modules (spec: 4)
        height: 1,               // block height multiplier
        heightByBrightness: false, // true: darkest colour stays 1×, brightest reaches `height`
        ecLevel: 'M',            // QR error correction: L | M | Q | H
        onStateChange: () => {},
        onRotateChange: () => {},
        onStatus: () => {},
      }, options);

      this.qrRotate = false; // QR rotation unlocked (follows drag)
      this.spin = 0;         // face-on angle the QR settles to when locked

      this.logo = null;
      this.qrText = null;
      this.qr = null;
      this.inst = null;
      this.prog = 0;
      this.target = 0;
      this.dirty = true;
      this.drawnProg = -1;
      this.rot = { x: 0, y: 0 };
      this.drag = { x: 0, y: 0 };
      this.visible = true;
      this.outlineCustom = new THREE.Color(this.opts.outlineColor);

      this._initThree();
      this._initInput();
      this._last = performance.now();
      this._frame = this._frame.bind(this);
      requestAnimationFrame(this._frame);
    }

    // ---------- public API ----------
    get isQR() { return this.target === 1; }
    static get styles() { return Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label })); }

    setLogoEmoji(text) { this.logo = emojiVoxels(text); this._rebuild(); }
    setLogoImage(img) { this.logo = imageVoxels(img); this._rebuild(); }
    setQR(text) { this.qrText = text; this._rebuild(); }
    setECLevel(level) { this.opts.ecLevel = level; this._rebuild(); }
    setDensity(k) { this.opts.density = k; this._rebuild(); }
    setFill(on) { this.opts.fill = on; this._rebuild(); }
    setCard(on) { this.opts.card = on; this._recolor(); }
    setHeight(h) { this.opts.height = h; this._placeCard(); this.dirty = true; }
    setHeightByBrightness(on) { this.opts.heightByBrightness = on; this.dirty = true; }
    setStyle(name) { if (STYLES[name]) { this.opts.style = name; this._applyDelays(); this.dirty = true; } }
    setOutline(mode, color) {
      this.opts.outline = mode;
      if (color) this.outlineCustom.set(color);
      if (this.outlineMesh) this.outlineMesh.visible = mode !== 'off';
      this.dirty = true;
    }
    show(qr) {
      if (!qr) {
        // Unwind any QR spin to within ±π so it doesn't spin all the way back.
        this.rot.y = Math.atan2(Math.sin(this.rot.y), Math.cos(this.rot.y));
      }
      this.target = qr ? 1 : 0;
      this.drag.x = this.drag.y = 0;
      this.spin = 0;
      this.qrRotate = false;
      this.container.setAttribute('aria-pressed', String(!!qr));
      this.opts.onStateChange(!!qr);
      this.opts.onRotateChange(false);
    }
    toggle() { this.show(!this.isQR); }

    // Unlock/lock QR rotation. Locking settles it on the nearest face-on angle.
    setQRRotate(on) {
      if (!this.isQR || on === this.qrRotate) return;
      if (!on) {
        const TAU = Math.PI * 2;
        this.spin = Math.round((this.spin + this.drag.y) / TAU) * TAU;
        this.drag.x = this.drag.y = 0;
      }
      this.qrRotate = on;
      this.opts.onRotateChange(on);
    }

    // Click / Enter on the stage: logo → QR, then QR clicks toggle rotation.
    activate() {
      if (this.isQR) this.setQRRotate(!this.qrRotate);
      else this.show(true);
    }

    // ---------- setup ----------
    _initThree() {
      const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.container.prepend(renderer.domElement);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 0.85));
      const sun = new THREE.DirectionalLight(0xffffff, 0.75);
      sun.position.set(6, 9, 12);
      this.scene.add(sun);

      this.group = new THREE.Group();
      this.scene.add(this.group);

      // White card behind the QR: scanner contrast + quiet zone.
      this.card = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide })
      );
      this.group.add(this.card);

      this.box = new THREE.BoxGeometry(1, 1, 1);
      this.material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
      // Outline = slightly larger back-face-only shell behind each cube.
      // Flush neighbours hide each other's shells, so only silhouettes get a line.
      this.outlineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });

      new ResizeObserver(() => this._resize()).observe(this.container);
      // Don't burn GPU while scrolled off-screen.
      new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }).observe(this.container);
      this._resize();
    }

    _resize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      const cam = this.camera;
      cam.aspect = w / h;
      const fit = SPAN * 1.3; // QR plus quiet zone, with a little breathing room
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      cam.position.set(0, 0, ((fit / 2) / tanHalf) / Math.min(1, cam.aspect));
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      this.dropHeight = tanHalf * cam.position.z + SPAN / 2 + 1;
    }

    _initInput() {
      const el = this.container;
      let down = null;
      // Ignore presses on controls placed inside the stage (e.g. a back button).
      const fromControl = e => e.target !== el && e.target.closest('button, a, input, select, textarea');
      el.addEventListener('pointerdown', e => {
        if (fromControl(e)) return;
        down = { x: e.clientX, y: e.clientY, dx: this.drag.x, dy: this.drag.y, moved: false };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', e => {
        if (!down) return;
        const mx = e.clientX - down.x, my = e.clientY - down.y;
        if (Math.hypot(mx, my) > 6) down.moved = true;
        if (down.moved && (!this.isQR || this.qrRotate)) {
          this.drag.y = down.dy + mx * 0.008;
          this.drag.x = Math.max(-1, Math.min(1, down.dx + my * 0.008));
        }
      });
      el.addEventListener('pointerup', () => {
        if (down && !down.moved) this.activate();
        down = null;
      });
      el.addEventListener('pointercancel', () => { down = null; });
      el.addEventListener('keydown', e => {
        if (e.target !== el) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.activate(); }
      });
    }

    // ---------- build ----------
    _style() { return reduceMotion ? STYLES.dissolve : STYLES[this.opts.style]; }
    _duration() { return reduceMotion ? 0.4 : this._style().duration; }

    _rebuild() {
      if (!this.logo || this.qrText == null) return;
      try {
        this.qr = qrVoxels(this.qrText || ' ', this.opts.ecLevel, this.opts.density, this.opts.fill);
      } catch (err) {
        this.opts.onStatus({ error: `Too much text for a QR code at error correction ${this.opts.ecLevel}.` });
        return;
      }
      const logo = this.logo.length ? this.logo
        : [{ x: 0, y: 0, sx: 0, sy: 0, sz: 0, r: 1, g: 1, b: 1, lum: 1 }];
      this.inst = this._pair(logo, this.qr);
      this._rankBrightness();
      this._applyDelays();
      this._buildMeshes(this.inst.length);
      this.dirty = true;

      const qr = this.qr;
      this.opts.onStatus({
        logoCubes: this.logo.length,
        qrCubes: qr.dark.length + qr.light.length,
        modules: qr.n,
        version: qr.version,
        density: qr.k,
        densityCapped: qr.k < qr.requestedK,
      });
    }

    _pair(logo, qr) {
      const byAngle = (a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x);
      const groups = [];
      if (qr.light.length) {
        // Darkest logo cubes go to dark modules, lightest to light ones,
        // so the logo's own palette provides the QR contrast.
        const sorted = logo.slice().sort((a, b) => a.lum - b.lum);
        const total = qr.dark.length + qr.light.length;
        const cut = Math.max(1, Math.round(sorted.length * qr.dark.length / total));
        const lightLogo = sorted.slice(cut);
        groups.push([sorted.slice(0, cut), qr.dark], [lightLogo.length ? lightLogo : sorted, qr.light]);
      } else {
        groups.push([logo.slice(), qr.dark]);
      }

      // Within each group, match by angle around the centre. The smaller set is
      // duplicated: overlapping cubes are invisible until they split mid-flight.
      const inst = [];
      for (const [L, Qs] of groups) {
        if (!Qs.length) continue;
        L.sort(byAngle);
        Qs.sort(byAngle);
        const N = Math.max(L.length, Qs.length);
        for (let i = 0; i < N; i++) {
          const a = L[Math.floor(i * L.length / N)];
          const b = Qs[Math.floor(i * Qs.length / N)];
          const ang = Math.atan2(a.y + b.y, a.x + b.x) + (Math.random() - 0.5) * 0.8;
          const out = 4 + Math.random() * 6;
          inst.push({
            a, b, qc: this._qrColor(a, b),
            axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
            r1: Math.random(), r2: Math.random(), r3: Math.random(),
            ha: 0, hq: 0, // relative brightness in logo / QR palettes (see _rankBrightness)
            dir: Math.random() < 0.5 ? -1 : 1,
            ox: Math.cos(ang) * out, oy: Math.sin(ang) * out, oz: (Math.random() - 0.5) * 14,
            delay: 0,
          });
        }
      }
      return inst;
    }

    // Cubes keep their logo colour. Contrast is only enforced when it's needed
    // to scan: dark modules on the white card, or a filled grid.
    _qrColor(a, b) {
      if (!b.dark) return lightenTo(a, 0.55);
      // 0.1 vs light modules at >= 0.55 gives roughly 7:1 contrast.
      return (this.opts.card || this.opts.fill) ? darkenTo(a, 0.1) : copyRGB(a);
    }
    _recolor() {
      if (this.inst) for (const it of this.inst) it.qc = this._qrColor(it.a, it.b);
      this._rankBrightness();
      this.dirty = true;
    }
    // Rank brightness within each palette, so "brighter = taller" is relative to
    // the image: in an all-bright logo only the brightest colour stands tallest.
    _rankBrightness() {
      if (!this.inst) return;
      const ha = relativeBrightness(this.inst.map(it => it.a));
      const hq = relativeBrightness(this.inst.map(it => it.qc));
      this.inst.forEach((it, i) => { it.ha = ha[i]; it.hq = hq[i]; });
    }
    _applyDelays() {
      if (!this.inst) return;
      const s = this._style();
      for (const it of this.inst) it.delay = Math.min(1, Math.max(0, s.delay(it))) * s.maxDelay;
    }

    _buildMeshes(N) {
      for (const m of [this.mesh, this.outlineMesh]) if (m) { this.group.remove(m); m.dispose(); }
      this.mesh = new THREE.InstancedMesh(this.box, this.material, N);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.setColorAt(0, new THREE.Color());
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.mesh);

      this.outlineMesh = new THREE.InstancedMesh(this.box, this.outlineMaterial, N);
      this.outlineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.outlineMesh.visible = this.opts.outline !== 'off';
      this.group.add(this.outlineMesh);

      this._placeCard();
    }

    _placeCard() {
      if (!this.qr) return;
      const { cell } = this.qr;
      // Spec says 4 modules of margin; phone cameras usually manage with less.
      const size = SPAN + cell * 2 * this.opts.quietZone;
      this.card.scale.set(size, size, 1);
      // Sit behind the deepest QR blocks and their outline shells.
      const tallest = Math.max(1, this.opts.height);
      this.card.position.z = -(cell * 0.3 * tallest + OUTLINE + 0.02);
    }

    // ---------- per frame ----------
    _frame(now) {
      requestAnimationFrame(this._frame);
      // rAF timestamps can be earlier than performance.now() taken in the constructor.
      const dt = Math.max(0, Math.min(0.05, (now - this._last) / 1000));
      this._last = now;
      if (!this.visible) return;

      const step = dt / this._duration();
      this.prog = this.target > this.prog ? Math.min(this.target, this.prog + step) : Math.max(this.target, this.prog - step);

      // Only rewrite instance data while something is moving or changed.
      if (this.inst && (this.prog !== this.drawnProg || this.dirty)) {
        this._updateInstances();
        this.drawnProg = this.prog;
        this.dirty = false;
      }

      // Card (if enabled) fades in during the last part of the morph.
      const cardMat = this.card.material;
      const cardTarget = this.opts.card ? Math.min(1, Math.max(0, (this.prog - 0.55) / 0.4)) : 0;
      cardMat.opacity += (cardTarget - cardMat.opacity) * 0.2;
      this.card.visible = cardMat.opacity > 0.001;

      if (this.opts.outline === 'auto') {
        this.outlineMaterial.color.copy(PAGE_OUTLINE).lerp(CARD_OUTLINE, cardMat.opacity);
      } else if (this.opts.outline === 'custom') {
        this.outlineMaterial.color.copy(this.outlineCustom);
      }

      // Logo: idle sway + drag. QR: flat and face-on so it scans, unless
      // rotation is unlocked, in which case it follows the drag.
      const idle = reduceMotion ? 0 : 1;
      let wantX, wantY;
      if (this.isQR) {
        const free = this.qrRotate ? 1 : 0;
        wantY = this.spin + this.drag.y * free;
        wantX = this.drag.x * free;
      } else {
        wantY = this.drag.y + idle * 0.45 * Math.sin(now / 1600);
        wantX = this.drag.x + idle * 0.12 * Math.sin(now / 2300);
      }
      const k = this.isQR ? 0.12 : 0.08;
      this.rot.y += (wantY - this.rot.y) * k;
      this.rot.x += (wantX - this.rot.x) * k;
      this.group.rotation.set(this.rot.x, this.rot.y, 0);

      this.renderer.render(this.scene, this.camera);
    }

    _updateInstances() {
      const style = this._style();
      const span = 1 - style.maxDelay;
      const { mesh, outlineMesh, inst } = this;
      const withOutline = outlineMesh.visible;
      const { height, heightByBrightness } = this.opts;
      const m4 = new THREE.Matrix4(), col = new THREE.Color();
      dropHeight = this.dropHeight;

      for (let i = 0; i < inst.length; i++) {
        const it = inst[i], a = it.a, qc = it.qc;
        const t = style.place(it, Math.min(1, Math.max(0, (this.prog - it.delay) / span)));
        col.setRGB(lerp(a.r, qc.r, t), lerp(a.g, qc.g, t), lerp(a.b, qc.b, t));
        mesh.setColorAt(i, col);
        S.z *= heightByBrightness ? lerp(1, height, lerp(it.ha, it.hq, t)) : height;
        m4.compose(P, Q, S);
        mesh.setMatrixAt(i, m4);
        if (withOutline) {
          // Shrink the shell with the cube so a vanishing cube doesn't leave a speck.
          S.addScalar(OUTLINE * 2 * Math.min(1, S.x / 0.1));
          m4.compose(P, Q, S);
          outlineMesh.setMatrixAt(i, m4);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      if (withOutline) outlineMesh.instanceMatrix.needsUpdate = true;
    }
  }

  window.LogoQRMorph = LogoQRMorph;
})();
