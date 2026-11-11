/*!
 * MNZ Perde – Çerez / izin yönetimi
 * Bağımlılık yok. Tercih, tarayıcının localStorage alanında birinci taraf olarak saklanır.
 * Zorunlu olmayan içerik ve scriptler yalnızca ilgili kategoriye izin verildiğinde yüklenir:
 *   <script type="text/plain" data-consent="analytics" src="..."></script>
 *   MNZConsent.whenGranted('functional', () => { ... })
 */
(function () {
  'use strict';

  // Çerez/hizmet envanteri değiştiğinde VERSION artırılır -> herkesten yeniden tercih istenir.
  var VERSION = '1.0';
  var STORAGE_KEY = 'mnz_cerez_tercihi';
  var MAX_AGE_DAYS = 365; // izin geçerlilik süresi (işletme tarafından doğrulanmalı)

  // Gerçekte kullanılan hizmetler. Kullanılmayan kategorilerde "available:false".
  var CATEGORIES = [
    { id: 'necessary', title: 'Zorunlu çerezler ve benzeri teknolojiler', locked: true, available: true,
      desc: 'Sitenin çalışması ve çerez tercihinizin hatırlanması için gereklidir. Kapatılamaz.',
      items: ['mnz_cerez_tercihi — tarayıcınızın yerel depolama alanında (localStorage) tutulur; birinci taraf; tercihinizi, tercih sürümünü ve kayıt zamanını saklar; süre: ' + MAX_AGE_DAYS + ' gün veya siz silene kadar.'] },
    { id: 'functional', title: 'İşlevsel çerezler ve dış içerikler', locked: false, available: true,
      desc: 'Instagram paylaşımlarımızın (@mnzperde) sitede gösterilmesini sağlar. İzin verdiğinizde içerik, üçüncü taraf sunuculardan yüklenir ve IP adresiniz ile tarayıcı bilgileriniz bu sağlayıcılara iletilir.',
      items: ['Behold (feeds.behold.so, behold.pictures) — Instagram akışı ve önizleme görselleri; üçüncü taraf.',
              'Instagram / Meta medya sunucuları (cdninstagram.com) — profil görseli ve video oynatma; üçüncü taraf.'] },
    { id: 'analytics', title: 'Analitik ve performans çerezleri', locked: false, available: false,
      desc: 'Bu sitede şu anda analitik veya performans ölçümü yapan herhangi bir çerez ya da hizmet kullanılmamaktadır.', items: [] },
    { id: 'marketing', title: 'Pazarlama ve reklam çerezleri', locked: false, available: false,
      desc: 'Bu sitede şu anda pazarlama, reklam veya yeniden hedefleme amaçlı herhangi bir çerez ya da hizmet kullanılmamaktadır.', items: [] }
  ];
  // İzin geri alındığında temizlenecek isteğe bağlı birinci taraf anahtarlar (şu an yok).
  var CLEANUP = { functional: [], analytics: ['_ga', '_gid', '_gat'], marketing: ['_fbp', '_gcl_au'] };

  var memoryState = null; // localStorage kullanılamazsa yalnızca bu sayfa için
  var listeners = [];

  function now() { return new Date(); }
  function read() {
    var raw = null;
    try { raw = window.localStorage.getItem(STORAGE_KEY); } catch (e) { return memoryState; }
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (!s || s.version !== VERSION) return null;            // envanter değişti
      if (!s.expires || new Date(s.expires) < now()) return null; // süresi doldu
      return s;
    } catch (e) { return null; }
  }
  function write(choices) {
    var t = now(), exp = new Date(t.getTime() + MAX_AGE_DAYS * 864e5);
    var s = { version: VERSION, savedAt: t.toISOString(), expires: exp.toISOString(), choices: {
      necessary: true,
      functional: !!choices.functional,
      analytics: !!choices.analytics && isAvailable('analytics'),
      marketing: !!choices.marketing && isAvailable('marketing') } };
    memoryState = s;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }
  function isAvailable(id) { for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i].available; return false; }
  function granted(id) { if (id === 'necessary') return true; var s = read(); return !!(s && s.choices && s.choices[id]); }

  function cleanup(id) {
    (CLEANUP[id] || []).forEach(function (name) {
      try { localStorage.removeItem(name); } catch (e) {}
      var host = location.hostname, parts = host.split('.');
      var domains = ['', host];
      for (var i = 1; i < parts.length - 1; i++) domains.push('.' + parts.slice(i).join('.'));
      domains.forEach(function (d) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
  }

  function activateScripts() {
    var nodes = document.querySelectorAll('script[type="text/plain"][data-consent]');
    Array.prototype.forEach.call(nodes, function (old) {
      if (!granted(old.getAttribute('data-consent'))) return;
      var s = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) { var a = old.attributes[i]; if (a.name !== 'type') s.setAttribute(a.name, a.value); }
      if (!old.src) s.text = old.text;
      old.parentNode.replaceChild(s, old);
    });
  }

  function emit(prev) {
    activateScripts();
    var cur = read() || memoryState;
    listeners.forEach(function (l) { try { l(cur); } catch (e) {} });
    try { document.dispatchEvent(new CustomEvent('mnz:consent', { detail: cur })); } catch (e) {}
    // İzin geri alındıysa: temizle ve yüklenmiş üçüncü taraf içeriği kaldırmak için sayfayı yenile
    if (prev && prev.choices) {
      var revoked = ['functional', 'analytics', 'marketing'].filter(function (k) { return prev.choices[k] && !(cur && cur.choices[k]); });
      if (revoked.length) { revoked.forEach(cleanup); setTimeout(function () { location.reload(); }, 150); }
    }
  }

  function save(choices) { var prev = read() || memoryState; write(choices); hideBanner(); closeDialog(); emit(prev); }
  function acceptAll() { save({ functional: true, analytics: true, marketing: true }); }
  function rejectAll() { save({ functional: false, analytics: false, marketing: false }); }

  /* ---------- Arayüz ---------- */
  var banner, overlay, lastFocus;
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  function buildBanner() {
    banner = el(
      '<section class="cc-banner" role="region" aria-labelledby="cc-title" aria-describedby="cc-text">' +
        '<div><h2 id="cc-title">Gizliliğiniz Bizim İçin Önemli</h2>' +
        '<p id="cc-text">MNZ Perde olarak web sitemizin düzgün çalışmasını sağlamak ve izniniz doğrultusunda deneyiminizi geliştirmek için çerezlerden yararlanabiliriz. Zorunlu çerezler dışında kalan çerezleri kabul etmek, reddetmek veya tercihlerinizi yönetmek tamamen sizin kontrolünüzdedir.</p>' +
        '<div class="cc-links"><a href="cerez-politikasi.html">Çerez Politikası</a><a href="kvkk-aydinlatma-metni.html">KVKK Aydınlatma Metni</a></div></div>' +
        '<div class="cc-actions">' +
          '<button type="button" class="cc-btn" data-cc="accept">Tümünü Kabul Et</button>' +
          '<button type="button" class="cc-btn" data-cc="reject">Tümünü Reddet</button>' +
          '<button type="button" class="cc-btn" data-cc="manage">Tercihleri Yönet</button>' +
        '</div></section>');
    banner.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-cc');
      if (a === 'accept') acceptAll(); else if (a === 'reject') rejectAll(); else if (a === 'manage') openDialog();
    });
    document.body.appendChild(banner);
  }
  function syncBannerHeight() {
    if (!banner || banner.classList.contains('cc-hidden')) { document.body.classList.remove('cc-open'); return; }
    document.body.classList.add('cc-open');
    document.body.style.setProperty('--cc-h', banner.offsetHeight + 'px');
  }
  function showBanner() { if (!banner) buildBanner(); banner.classList.remove('cc-hidden'); syncBannerHeight(); }
  function hideBanner() { if (banner) banner.classList.add('cc-hidden'); syncBannerHeight(); }

  function catHtml(c, state) {
    var checked = c.locked || (state && state.choices && state.choices[c.id]);
    var control = c.locked
      ? '<span class="cc-state">Her zaman etkin</span>'
      : (c.available
          ? '<label class="cc-switch"><input type="checkbox" role="switch" data-cat="' + c.id + '"' + (checked ? ' checked' : '') + ' aria-describedby="cc-d-' + c.id + '"><span aria-hidden="true"></span><span class="cc-visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">' + c.title + '</span></label>'
          : '<span class="cc-state">Kullanılmıyor</span>');
    var items = c.items.length
      ? '<details class="cc-details"><summary>Kullanılan çerez ve hizmetler (' + c.items.length + ')</summary><ul>' + c.items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul></details>' : '';
    return '<div class="cc-cat"><div class="cc-cat-head"><h3 id="cc-h-' + c.id + '">' + c.title + '</h3>' + control + '</div><p id="cc-d-' + c.id + '">' + c.desc + '</p>' + items + '</div>';
  }

  function openDialog() {
    lastFocus = document.activeElement;
    var state = read() || memoryState;
    var meta = state ? 'Son kayıt: ' + new Date(state.savedAt).toLocaleString('tr-TR') + ' · Tercih sürümü ' + state.version : 'Henüz bir tercih kaydetmediniz.';
    overlay = el(
      '<div class="cc-overlay" role="presentation">' +
        '<div class="cc-dialog" role="dialog" aria-modal="true" aria-labelledby="cc-dlg-title" aria-describedby="cc-dlg-desc">' +
          '<button type="button" class="cc-close" data-cc="close" aria-label="Tercih panelini kapat">×</button>' +
          '<h2 id="cc-dlg-title">Çerez Tercihleri</h2>' +
          '<p id="cc-dlg-desc">Zorunlu olanlar dışındaki kategoriler varsayılan olarak kapalıdır. Dilediğiniz zaman sayfanın altındaki “Çerez Tercihleri” bağlantısından değiştirebilir veya geri alabilirsiniz. Ayrıntılar için <a href="cerez-politikasi.html" style="color:#8A5D2B;font-weight:700">Çerez Politikası</a>.</p>' +
          CATEGORIES.map(function (c) { return catHtml(c, state); }).join('') +
          '<p class="cc-meta">' + meta + '</p>' +
          '<div class="cc-dialog-actions">' +
            '<button type="button" class="cc-btn" data-cc="reject">Tümünü Reddet</button>' +
            '<button type="button" class="cc-btn" data-cc="save">Seçimi Kaydet</button>' +
            '<button type="button" class="cc-btn" data-cc="accept">Tümünü Kabul Et</button>' +
          '</div></div></div>');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { closeDialog(); return; }
      var a = e.target.getAttribute && e.target.getAttribute('data-cc');
      if (a === 'close') closeDialog();
      else if (a === 'accept') acceptAll();
      else if (a === 'reject') rejectAll();
      else if (a === 'save') {
        var ch = {};
        Array.prototype.forEach.call(overlay.querySelectorAll('input[data-cat]'), function (i) { ch[i.getAttribute('data-cat')] = i.checked; });
        save(ch);
      }
    });
    overlay.addEventListener('keydown', trap);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    var first = overlay.querySelector('input[data-cat]') || overlay.querySelector('.cc-close');
    first.focus();
  }
  function closeDialog() {
    if (!overlay) return;
    overlay.remove(); overlay = null;
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function trap(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeDialog(); return; }
    if (e.key !== 'Tab') return;
    var f = overlay.querySelectorAll('button,a[href],input:not([disabled]),summary');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- Genel API ---------- */
  window.MNZConsent = {
    version: VERSION,
    granted: granted,
    get: function () { return read() || memoryState; },
    open: openDialog,
    grant: function (id) { var s = read() || memoryState; var c = s ? Object.assign({}, s.choices) : {}; c[id] = true; save(c); },
    onChange: function (fn) { listeners.push(fn); },
    whenGranted: function (id, fn) {
      if (granted(id)) { fn(); return; }
      var done = false; listeners.push(function () { if (!done && granted(id)) { done = true; fn(); } });
    }
  };

  function init() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-cc-open]');
      if (t) { e.preventDefault(); openDialog(); }
    });
    if (!read()) showBanner();
    activateScripts();
    window.addEventListener('resize', syncBannerHeight);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
