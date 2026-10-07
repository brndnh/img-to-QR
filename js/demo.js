// Wires the demo page's controls to LogoQRMorph.
(() => {
  // Max bytes a QR code (version 40) can hold at each error-correction level.
  const CAPACITY = { L: 2953, M: 2331, Q: 1663, H: 1273 };

  const $ = id => document.getElementById(id);
  const radioValue = name => document.querySelector(`input[name="${name}"]:checked`).value;
  const onRadio = (name, fn) =>
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.addEventListener('change', () => fn(r.value)));

  const stage = $('stage');
  const hint = $('hint');
  const toggleBtn = $('toggle');
  const qrInput = $('qrtext');
  const qrError = $('qrError');
  const counter = $('counter');
  const styleSelect = $('style');
  const outlineColor = $('outlineColor');
  const emojiInput = $('emoji');
  const fileInput = $('file');

  // Empty QR field → encode the URL of the page it's shown on.
  const qrValue = () => qrInput.value.trim() || location.href;

  const morph = new LogoQRMorph(stage, {
    onStateChange(isQR) {
      toggleBtn.textContent = isQR ? '← Back to logo' : 'Show QR';
      toggleBtn.classList.toggle('is-back', isQR);
    },
    onRotateChange(rotating) {
      if (!morph.isQR) {
        hint.textContent = 'click to transform · drag to tilt';
        stage.setAttribute('aria-label', 'Logo. Activate to transform into a QR code.');
        return;
      }
      hint.textContent = rotating ? 'drag to rotate · click to lock' : 'scan me · click to unlock rotation';
      stage.setAttribute('aria-label', rotating
        ? 'QR code, rotation unlocked. Activate to lock it face-on.'
        : 'QR code. Activate to unlock rotation.');
    },
    onStatus(s) {
      qrError.textContent = s.error || '';
      if (s.error) return;
      $('densityNote').textContent = s.densityCapped ? `reduced to ${s.density}×${s.density}, code is large` : '';
    },
  });

  // ---------- preview ----------
  toggleBtn.addEventListener('click', () => morph.toggle());

  // ---------- logo ----------
  const useEmoji = text => {
    fileInput.value = '';
    emojiInput.placeholder = '';
    morph.setLogoEmoji(text || '💮');
  };
  emojiInput.addEventListener('input', () => useEmoji(emojiInput.value));

  function loadImage(url, name) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      morph.setLogoImage(img);
      emojiInput.value = '';
      emojiInput.placeholder = name ? `Using ${name}` : 'Using uploaded image';
    };
    img.onerror = () => { emojiInput.placeholder = `Couldn't load ${name || url}`; };
    img.src = url;
  }
  $('uploadBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (f) loadImage(URL.createObjectURL(f), f.name);
  });

  // Emoji picker (emoji-picker-element, loaded from CDN).
  const emojiBtn = $('emojiBtn');
  const emojiPop = $('emojiPop');
  let picker = null;

  let pickerLoading = false;

  // The picker script is a CDN module that may still be downloading on the first
  // click, so wait a few seconds for it before falling back.
  function ensurePicker() {
    if (picker || pickerLoading) return;
    if (customElements.get('emoji-picker')) { picker = buildPicker(); return; }
    pickerLoading = true;
    emojiPop.innerHTML = '<div class="fallback">Loading emoji…</div>';
    const timeout = new Promise(resolve => setTimeout(resolve, 5000));
    Promise.race([customElements.whenDefined('emoji-picker'), timeout]).then(() => {
      pickerLoading = false;
      if (customElements.get('emoji-picker')) {
        picker = buildPicker();
        if (!emojiPop.hidden) focusPicker();
        return;
      }
      // CDN blocked or offline: point people at the OS emoji keyboard instead.
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      emojiPop.innerHTML = `<div class="fallback">Emoji picker couldn't load. Click the text box and use your system emoji keyboard (${mac ? 'Ctrl + Cmd + Space' : 'Win + .'}).</div>`;
    });
  }

  function focusPicker() {
    // Focus the picker's search box once it has rendered.
    requestAnimationFrame(() => picker?.shadowRoot?.querySelector('input')?.focus());
  }

  function buildPicker() {
    const el = document.createElement('emoji-picker');
    el.classList.add('dark');
    // The picker's own rounded hover states live in its shadow DOM, out of
    // reach of the page stylesheet, so inject a square override.
    if (el.shadowRoot) {
      const style = document.createElement('style');
      style.textContent = '*, *::before, *::after { border-radius: 0 !important; }';
      el.shadowRoot.appendChild(style);
    }
    el.addEventListener('emoji-click', e => {
      emojiInput.value = e.detail.unicode;
      useEmoji(e.detail.unicode);
      setPickerOpen(false);
      emojiInput.focus();
    });
    emojiPop.replaceChildren(el);
    return el;
  }

  function setPickerOpen(open) {
    if (open) ensurePicker();
    emojiPop.hidden = !open;
    emojiBtn.setAttribute('aria-expanded', String(open));
    if (open && picker) focusPicker();
  }

  emojiBtn.addEventListener('click', () => setPickerOpen(emojiPop.hidden));
  document.addEventListener('pointerdown', e => {
    if (!emojiPop.hidden && !emojiPop.contains(e.target) && !emojiBtn.contains(e.target)) setPickerOpen(false);
  });
  emojiPop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { setPickerOpen(false); emojiBtn.focus(); }
  });

  // ---------- QR code ----------
  function updateCounter() {
    const bytes = new TextEncoder().encode(qrValue()).length;
    const cap = CAPACITY[radioValue('ec')];
    counter.textContent = `${bytes.toLocaleString()} / ${cap.toLocaleString()} bytes`;
    counter.classList.toggle('error', bytes > cap);
  }
  qrInput.addEventListener('input', () => { updateCounter(); morph.setQR(qrValue()); });
  $('cardToggle').addEventListener('change', e => morph.setCard(e.target.checked));

  // ---------- look ----------
  for (const { id, label } of LogoQRMorph.styles) styleSelect.add(new Option(label, id));
  styleSelect.addEventListener('change', () => morph.setStyle(styleSelect.value));

  const heightSlider = $('height');
  heightSlider.addEventListener('input', () => {
    const h = Number(heightSlider.value);
    $('heightValue').textContent = `${h.toFixed(1)}×`;
    morph.setHeight(h);
  });
  $('heightByBrightness').addEventListener('change', e => {
    // In brightness mode the slider sets the brightest colour; the darkest stays 1×.
    $('heightLabel').textContent = e.target.checked ? 'Brightest colour height' : 'Block height';
    morph.setHeightByBrightness(e.target.checked);
    // At 1× there'd be no visible difference, so give it a visible starting point.
    if (e.target.checked && Number(heightSlider.value) <= 1) {
      heightSlider.value = 2.5;
      heightSlider.dispatchEvent(new Event('input'));
    }
  });

  // ---------- advanced ----------
  onRadio('ec', v => { updateCounter(); morph.setECLevel(v); });
  onRadio('density', v => morph.setDensity(Number(v)));
  onRadio('outline', v => {
    outlineColor.hidden = v !== 'custom';
    morph.setOutline(v, outlineColor.value);
  });
  outlineColor.addEventListener('input', () => morph.setOutline(radioValue('outline'), outlineColor.value));
  $('fillToggle').addEventListener('change', e => morph.setFill(e.target.checked));

  // ---------- initial state ----------
  // Optional: ?logo=img/logo.svg&qr=... (file paths need a local server)
  const params = new URLSearchParams(location.search);
  if (params.get('qr')) qrInput.value = params.get('qr');

  morph.setLogoEmoji(emojiInput.value || '💮');
  morph.setQR(qrValue());
  updateCounter();
  if (params.get('logo')) loadImage(params.get('logo'));
})();
