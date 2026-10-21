// The signer page's only script: plain ES5 (no React, no build step), so it
// runs on older iOS Safari and Android browsers. Its sha256 is allowed by the
// page's Content-Security-Policy. Without it the page still works: the form
// shows the typed-signature fields and a Finish button.
//
// It adds: the guided Start → Sign here → Next → Finish bar, the full-screen
// "your signature" sheet, drawing with a finger, the view beacon, and — on
// the real document pages — the signature, date and printed name previews in
// their boxes.

export const SIGNER_SCRIPT = String.raw`
(function () {
  var root = document.getElementById('sg-root');
  if (!root || !document.querySelector || !window.addEventListener) return;
  var form = document.getElementById('sg-form');
  if (!form) return;

  function toArray(list) { var a = []; for (var i = 0; i < list.length; i++) a.push(list[i]); return a; }
  function hasClass(el, c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') > -1; }
  function addClass(el, c) { if (!hasClass(el, c)) el.className = (el.className + ' ' + c).replace(/^\s+/, ''); }
  function removeClass(el, c) { el.className = (' ' + el.className + ' ').split(' ' + c + ' ').join(' ').replace(/^\s+|\s+$/g, ''); }
  function setText(el, text) { if (el) { if ('textContent' in el) el.textContent = text; else el.innerText = text; } }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }

  addClass(root, 'sg-js');

  var fonts = {};
  try { fonts = JSON.parse(root.getAttribute('data-fonts') || '{}'); } catch (e) {}

  // Viewed: sent by script so email link scanners don't count as a view
  try {
    var beacon = new XMLHttpRequest();
    beacon.open('POST', root.getAttribute('data-view-url'), true);
    beacon.send('');
  } catch (e) {}

  var fields = toArray(root.querySelectorAll('.sg-field'));
  var total = fields.length;
  var bar = document.getElementById('sg-bar');
  var barBtn = document.getElementById('sg-bar-btn');
  var barProgress = document.getElementById('sg-bar-progress');
  var overlay = document.getElementById('sg-overlay');
  var adopt = document.getElementById('sg-adopt');
  var adoptBtn = document.getElementById('sg-adopt-btn');
  var adoptClose = document.getElementById('sg-adopt-close');
  var adoptError = document.getElementById('sg-adopt-error');
  var nameInput = document.getElementById('sg-typed-name');
  var drawnInput = document.getElementById('sg-drawn-png');
  var methodInputs = toArray(form.querySelectorAll('input[name=method]'));
  var styleInputs = toArray(form.querySelectorAll('input[name=style]'));
  var samples = toArray(form.querySelectorAll('.sg-style-sample'));
  var capacityInputs = toArray(form.querySelectorAll('input[name=capacity]'));
  var canvas = document.getElementById('sg-canvas');
  var clearBtn = document.getElementById('sg-clear');

  var adopted = null;      // { method, text, style, png, name }
  var mode = 'start';      // start | sign | next | finish
  var pendingField = null; // field waiting for a signature to be adopted
  var submitting = false;

  function firstUnsigned() { for (var i = 0; i < fields.length; i++) if (!hasClass(fields[i], 'is-done')) return i; return -1; }
  function fieldLabel(f) { return f.getAttribute('data-label') || 'Sign'; }

  function scrollToEl(el) {
    // A box on a document page: show it a third of the way down, with the page around it
    var offset = hasClass(el, 'sg-onpage') ? Math.round((window.innerHeight || 600) * 0.3) : 16;
    var top = el.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0) - offset;
    try { window.scrollTo({ top: top, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, top); }
  }

  function setCurrent(index) {
    for (var k = 0; k < fields.length; k++) {
      if (k === index) addClass(fields[k], 'is-current'); else removeClass(fields[k], 'is-current');
    }
  }

  function render() {
    var idx = firstUnsigned();
    removeClass(bar, 'is-finish');
    if (mode === 'start') {
      setText(barProgress, total === 1 ? 'You need to sign in 1 place' : 'You need to sign in ' + total + ' places');
      setText(barBtn, 'Start');
    } else if (idx === -1) {
      mode = 'finish';
      setText(barProgress, 'All signed. One last step.');
      setText(barBtn, 'Finish');
      addClass(bar, 'is-finish');
    } else if (mode === 'next') {
      setText(barProgress, (total - idx) + ' more to sign');
      setText(barBtn, 'Next');
    } else {
      setText(barProgress, 'Step ' + (idx + 1) + ' of ' + total + ': ' + fieldLabel(fields[idx]));
      setText(barBtn, 'Sign here');
    }
  }

  function goToNextField() {
    var idx = firstUnsigned();
    if (idx === -1) { mode = 'finish'; render(); return; }
    mode = 'sign';
    setCurrent(idx);
    scrollToEl(fields[idx]);
    render();
  }

  // ── Signature sheet ──────────────────────────────────────────────
  function currentMethod() { for (var i = 0; i < methodInputs.length; i++) if (methodInputs[i].checked) return methodInputs[i].value; return 'typed'; }
  function currentStyle() { for (var i = 0; i < styleInputs.length; i++) if (styleInputs[i].checked) return styleInputs[i].value; return styleInputs.length ? styleInputs[0].value : ''; }

  function syncStyles() {
    var name = (nameInput && nameInput.value.replace(/^\s+|\s+$/g, '')) || 'Your name';
    for (var i = 0; i < samples.length; i++) setText(samples[i], name);
    var groups = styleInputs.concat(capacityInputs);
    for (var j = 0; j < groups.length; j++) {
      var label = groups[j].parentNode;
      if (groups[j].checked) addClass(label, 'is-checked'); else removeClass(label, 'is-checked');
    }
  }

  function syncMethod() {
    if (currentMethod() === 'drawn') {
      addClass(adopt, 'is-draw');
      setupCanvas();
      // Bring the drawing box into view on small screens
      setTimeout(function () { try { canvas.scrollIntoView(false); } catch (e) {} }, 60);
    } else removeClass(adopt, 'is-draw');
    setText(adoptError, '');
    adoptError.style.display = 'none';
  }

  function openAdopt() {
    addClass(adopt, 'is-open');
    document.body.style.overflow = 'hidden';
    syncMethod();
    syncStyles();
    adopt.scrollTop = 0;
    try { (currentMethod() === 'typed' ? nameInput : adoptBtn).focus(); } catch (e) {}
  }

  function closeAdopt() {
    removeClass(adopt, 'is-open');
    document.body.style.overflow = '';
    pendingField = null;
  }

  function showAdoptError(text) {
    setText(adoptError, text);
    adoptError.style.display = 'block';
  }

  // ── Previews on the document pages ─────────────────────────────────
  var fills = toArray(root.querySelectorAll('.sg-fill'));
  var today = root.getAttribute('data-today') || '';
  var owner = root.getAttribute('data-owner') || '';

  function currentCapacity() { for (var i = 0; i < capacityInputs.length; i++) if (capacityInputs[i].checked) return capacityInputs[i].value; return 'owner'; }
  function signerName() { return adopted ? (adopted.name || '') : ''; }
  function printedName() {
    var name = signerName(), cap = currentCapacity();
    if (cap === 'joint_owner') return name + ' (joint owner)';
    if (cap === 'authorised_person') return owner ? name + ' for ' + owner : name + ' (authorised person)';
    return name;
  }

  // Largest font size (px) at which the text fits the box
  function fitText(el, box, maxRatio) {
    var size = Math.max(6, Math.floor(box.clientHeight * maxRatio));
    el.style.fontSize = size + 'px';
    while (size > 6 && el.scrollWidth > box.clientWidth) { size -= 1; el.style.fontSize = size + 'px'; }
  }

  function updateFills() {
    for (var i = 0; i < fills.length; i++) {
      var span = fills[i], kind = span.getAttribute('data-fill'), text = '';
      var field = document.querySelector('.sg-field[data-field-id="' + span.getAttribute('data-for') + '"]');
      if (field && hasClass(field, 'is-done') && adopted) {
        if (kind === 'date') text = today;
        else if (kind === 'name') text = printedName();
        else if (kind === 'representative' && currentCapacity() === 'authorised_person') text = signerName();
      }
      setText(span, text);
      if (text) fitText(span, span, 0.8);
    }
  }

  function fitPreview(field) {
    if (!hasClass(field, 'sg-onpage')) return;
    var box = field.querySelector('.sg-sign-box');
    var span = field.querySelector('.sg-sign-preview span');
    if (box && span) fitText(span, box, 0.85);
  }

  on(window, 'resize', function () {
    for (var i = 0; i < fields.length; i++) if (hasClass(fields[i], 'is-done')) fitPreview(fields[i]);
    updateFills();
  });

  function applyTo(field) {
    var preview = field.querySelector('.sg-sign-preview');
    while (preview.firstChild) preview.removeChild(preview.firstChild);
    if (adopted.method === 'drawn') {
      var img = document.createElement('img');
      img.src = adopted.png;
      img.alt = 'Your signature';
      preview.appendChild(img);
    } else {
      var span = document.createElement('span');
      span.style.fontFamily = fonts[adopted.style] || 'cursive';
      setText(span, adopted.text);
      preview.appendChild(span);
    }
    addClass(field, 'is-done');
    removeClass(field, 'is-current');
    fitPreview(field);
    updateFills();
    var box = field.querySelector('.sg-sign-box');
    if (box) box.setAttribute('aria-label', fieldLabel(field) + ': signed. Tap to change your signature.');
  }

  function signField(field) {
    if (!adopted || hasClass(field, 'is-done')) {
      pendingField = field;
      openAdopt();
      return;
    }
    applyTo(field);
    mode = firstUnsigned() === -1 ? 'finish' : 'next';
    render();
  }

  on(adoptBtn, 'click', function () {
    var method = currentMethod();
    var name = nameInput.value.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
    if (name.length < 2) { showAdoptError('Please type your full name.'); try { nameInput.focus(); } catch (e) {} return; }
    if (method === 'drawn') {
      if (!drawing.strokes) { showAdoptError('Please draw your signature in the box, or choose Type.'); return; }
      adopted = { method: 'drawn', png: exportDrawing(), name: name };
      drawnInput.value = adopted.png;
    } else {
      adopted = { method: 'typed', text: name, style: currentStyle(), name: name };
      drawnInput.value = '';
    }
    var target = pendingField;
    closeAdopt();
    for (var i = 0; i < fields.length; i++) if (hasClass(fields[i], 'is-done')) applyTo(fields[i]);
    if (target) { applyTo(target); scrollToEl(target); }
    mode = firstUnsigned() === -1 ? 'finish' : 'next';
    render();
  });
  on(adoptClose, 'click', closeAdopt);
  on(document, 'keydown', function (e) { if ((e.key === 'Escape' || e.keyCode === 27) && hasClass(adopt, 'is-open')) closeAdopt(); });
  for (var m = 0; m < methodInputs.length; m++) on(methodInputs[m], 'change', syncMethod);
  for (var s = 0; s < styleInputs.length; s++) on(styleInputs[s], 'change', syncStyles);
  for (var c = 0; c < capacityInputs.length; c++) on(capacityInputs[c], 'change', syncStyles);
  on(nameInput, 'input', syncStyles);
  on(nameInput, 'keyup', syncStyles);

  // ── Drawing ──────────────────────────────────────────────────────
  var drawing = { ready: false, strokes: 0, ctx: null, ratio: 1, down: false, lastX: 0, lastY: 0, minX: 1e9, minY: 1e9, maxX: -1, maxY: -1 };

  function setupCanvas() {
    if (!canvas || !canvas.getContext) return;
    var width = canvas.offsetWidth;
    if (!width) return;
    if (drawing.ready && drawing.width === width) return;
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(200 * ratio);
    var ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0d1f5a';
    drawing.ctx = ctx;
    drawing.ratio = ratio;
    drawing.width = width;
    drawing.ready = true;
    drawing.strokes = 0;
    drawing.minX = drawing.minY = 1e9; drawing.maxX = drawing.maxY = -1;
  }

  function point(e) {
    var rect = canvas.getBoundingClientRect();
    var src = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }
  function grow(p) {
    if (p.x < drawing.minX) drawing.minX = p.x; if (p.y < drawing.minY) drawing.minY = p.y;
    if (p.x > drawing.maxX) drawing.maxX = p.x; if (p.y > drawing.maxY) drawing.maxY = p.y;
  }
  function start(e) {
    if (!drawing.ready) setupCanvas();
    if (!drawing.ctx) return;
    if (e.preventDefault) e.preventDefault();
    var p = point(e);
    drawing.down = true; drawing.lastX = p.x; drawing.lastY = p.y;
    drawing.ctx.beginPath(); drawing.ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2); drawing.ctx.fillStyle = '#0d1f5a'; drawing.ctx.fill();
    grow(p);
    drawing.strokes++;
    adoptError.style.display = 'none';
  }
  function move(e) {
    if (!drawing.down) return;
    if (e.preventDefault) e.preventDefault();
    var p = point(e);
    drawing.ctx.beginPath(); drawing.ctx.moveTo(drawing.lastX, drawing.lastY); drawing.ctx.lineTo(p.x, p.y); drawing.ctx.stroke();
    drawing.lastX = p.x; drawing.lastY = p.y;
    grow(p);
  }
  function end() { drawing.down = false; }

  if (canvas) {
    var passive = false;
    try { var opts = Object.defineProperty({}, 'passive', { get: function () { passive = { passive: false }; return true; } }); window.addEventListener('sgtest', null, opts); } catch (e) {}
    on(canvas, 'touchstart', start, passive);
    on(canvas, 'touchmove', move, passive);
    on(canvas, 'touchend', end);
    on(canvas, 'mousedown', start);
    on(window, 'mousemove', move);
    on(window, 'mouseup', end);
  }
  on(clearBtn, 'click', function () {
    if (!drawing.ctx) return;
    drawing.ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawing.strokes = 0;
    drawing.minX = drawing.minY = 1e9; drawing.maxX = drawing.maxY = -1;
  });

  function exportDrawing() {
    var r = drawing.ratio, pad = 8;
    var x = Math.max(0, Math.floor((drawing.minX - pad) * r));
    var y = Math.max(0, Math.floor((drawing.minY - pad) * r));
    var w = Math.min(canvas.width - x, Math.ceil((drawing.maxX - drawing.minX + pad * 2) * r));
    var h = Math.min(canvas.height - y, Math.ceil((drawing.maxY - drawing.minY + pad * 2) * r));
    var out = document.createElement('canvas');
    out.width = Math.max(w, 1); out.height = Math.max(h, 1);
    out.getContext('2d').drawImage(canvas, x, y, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  // ── Fields, Start and Finish ──────────────────────────────────────
  for (var f = 0; f < fields.length; f++) {
    (function (field) {
      var tap = function () { mode = 'sign'; setCurrent(fields.indexOf ? fields.indexOf(field) : 0); signField(field); };
      on(field.querySelector('.sg-sign-box'), 'click', tap);
      on(field.querySelector('.sg-flag'), 'click', tap);
    })(fields[f]);
  }

  var startLinks = toArray(root.querySelectorAll('[data-sg-start]'));
  for (var sl = 0; sl < startLinks.length; sl++) {
    on(startLinks[sl], 'click', function (e) { if (e.preventDefault) e.preventDefault(); goToNextField(); });
  }

  function finish() {
    if (submitting) return;
    if (firstUnsigned() !== -1 || !adopted) { goToNextField(); return; }
    for (var i = 0; i < methodInputs.length; i++) methodInputs[i].checked = methodInputs[i].value === adopted.method;
    if (adopted.method === 'typed') {
      nameInput.value = adopted.text;
      for (var j = 0; j < styleInputs.length; j++) styleInputs[j].checked = styleInputs[j].value === adopted.style;
    }
    submitting = true;
    barBtn.setAttribute('disabled', 'disabled');
    addClass(overlay, 'is-open');
    form.submit();
  }

  on(barBtn, 'click', function () {
    if (mode === 'start' || mode === 'next') { goToNextField(); return; }
    if (mode === 'finish') { finish(); return; }
    var idx = firstUnsigned();
    if (idx === -1) { mode = 'finish'; render(); return; }
    setCurrent(idx);
    signField(fields[idx]);
  });

  on(form, 'submit', function (e) {
    if (submitting) return;
    if (e.preventDefault) e.preventDefault();
    finish();
  });

  // Coming back after an error: let them pick up where they were
  if (root.getAttribute('data-has-error') === '1') mode = 'sign';
  render();
})();
`
