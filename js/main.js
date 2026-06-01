/* BurnedWolf Website - Runtime
   Schematic / Industrial theme — v1.8.0
*/

(function () {
  'use strict';

  const SUPPORTED = ['tr', 'en', 'ru'];
  const STORAGE_KEY = 'burnedwolf.lang';

  /* ---------------------------------------------------------
     LANGUAGE
     --------------------------------------------------------- */

  function detectInitialLang() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
    return null;
  }

  function previewLangForPicker() {
    const browser = (navigator.language || 'en').toLowerCase().slice(0, 2);
    return SUPPORTED.includes(browser) ? browser : 'en';
  }

  function tr(key) {
    const lang = document.documentElement.getAttribute('data-lang') || 'en';
    const dict = window.I18N[lang] || window.I18N.en;
    return dict[key] || key;
  }

  function applyLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    const dict = window.I18N[lang];
    if (!dict) return;

    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('data-lang', lang);

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = dict[key];
      if (typeof val === 'string') el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      const val = dict[key];
      if (typeof val === 'string') el.innerHTML = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = dict[key];
      if (typeof val === 'string') el.setAttribute('placeholder', val);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      const val = dict[key];
      if (typeof val === 'string') el.setAttribute('aria-label', val);
    });

    const currentEl = document.querySelector('.lang-switcher .current');
    if (currentEl) currentEl.textContent = lang.toUpperCase();

    document.querySelectorAll('.lang-dropdown button').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
  }

  function persistLang(lang) {
    if (SUPPORTED.includes(lang)) localStorage.setItem(STORAGE_KEY, lang);
  }

  /* ---------------------------------------------------------
     LANGUAGE OVERLAY
     --------------------------------------------------------- */

  function setupLangOverlay() {
    const overlay = document.getElementById('langOverlay');
    if (!overlay) return;

    const tiles = overlay.querySelectorAll('.lang-tile');
    const continueBtn = overlay.querySelector('.lang-continue');
    let picked = null;

    const saved = detectInitialLang();
    if (saved) {
      applyLang(saved);
      overlay.classList.add('hidden');
      setTimeout(() => overlay.remove(), 500);
      document.body.style.overflow = '';
      return;
    }

    applyLang(previewLangForPicker());
    document.body.style.overflow = 'hidden';

    tiles.forEach(tile => {
      tile.addEventListener('click', () => {
        tiles.forEach(t => t.classList.remove('active'));
        tile.classList.add('active');
        picked = tile.dataset.lang;
        continueBtn.disabled = false;
        applyLang(picked);
      });
    });

    continueBtn.addEventListener('click', () => {
      if (!picked) return;
      applyLang(picked);
      persistLang(picked);
      overlay.classList.add('hidden');
      setTimeout(() => {
        overlay.remove();
        document.body.style.overflow = '';
      }, 500);
    });
  }

  /* ---------------------------------------------------------
     LANGUAGE SWITCHER (top nav)
     --------------------------------------------------------- */

  function setupLangSwitcher() {
    const switcher = document.querySelector('.lang-switcher');
    if (!switcher) return;
    const dropdown = switcher.querySelector('.lang-dropdown');

    switcher.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));

    dropdown.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyLang(btn.dataset.lang);
        persistLang(btn.dataset.lang);
        dropdown.classList.remove('open');
      });
    });
  }

  /* ---------------------------------------------------------
     NAV SCROLL STATE
     --------------------------------------------------------- */

  function setupNavScroll() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const onScroll = () => {
      if (window.scrollY > 20) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------------------------------------------------------
     REVEAL ON SCROLL
     --------------------------------------------------------- */

  function setupReveal() {
    const targets = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      targets.forEach(t => t.classList.add('visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(t => io.observe(t));
  }

  /* ---------------------------------------------------------
     FAQ
     --------------------------------------------------------- */

  function setupFaq() {
    document.querySelectorAll('.faq-item').forEach(item => {
      const q = item.querySelector('.faq-q');
      q.addEventListener('click', () => {
        const wasOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
        if (!wasOpen) item.classList.add('open');
      });
    });
  }

  /* ---------------------------------------------------------
     SMOOTH ANCHOR SCROLL
     --------------------------------------------------------- */

  function setupAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (href.length <= 1) return;
        const target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        const offset = 70;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      });
    });
  }

  /* ---------------------------------------------------------
     STAT COUNTER
     --------------------------------------------------------- */

  function setupCounters() {
    const stats = document.querySelectorAll('.stat .num[data-count]');
    if (!stats.length) return;

    const animate = (el) => {
      const end = parseInt(el.dataset.count, 10);
      const suffix = el.dataset.suffix || '';
      const dur = 1100;
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.floor(end * eased) + suffix;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = end + suffix;
      };
      requestAnimationFrame(step);
    };

    if (!('IntersectionObserver' in window)) {
      stats.forEach(animate);
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          animate(e.target);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });
    stats.forEach(s => io.observe(s));
  }

  /* ---------------------------------------------------------
     BOOT
     --------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', () => {
    setupLangOverlay();
    setupLangSwitcher();
    setupNavScroll();
    setupReveal();
    setupFaq();
    setupAnchors();
    setupCounters();
  });
})();
