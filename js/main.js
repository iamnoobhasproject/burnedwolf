/* BurnedWolf Website - Runtime
   Schematic / Industrial theme — v1.9.0
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
     DOWNLOAD ADVISORY GATE
     --------------------------------------------------------- */

  function setupDownloadGate() {
    const trigger = document.getElementById('winDownloadBtn');
    const gate = document.getElementById('dlGate');
    if (!trigger || !gate) return;

    const card = gate.querySelector('.dl-gate-card');
    const closeBtn = document.getElementById('dlGateClose');
    const playBtn = document.getElementById('dlGatePlay');
    const audio = document.getElementById('dlGateAudio');
    const bar = document.getElementById('dlGateBar');
    const barFill = document.getElementById('dlGateBarFill');
    const curEl = document.getElementById('dlGateCur');
    const durEl = document.getElementById('dlGateDur');
    const dl = document.getElementById('dlGateDownload');
    const lockFill = document.getElementById('dlGateLockFill');
    const countEl = document.getElementById('dlGateCount');

    const AUDIO_BY_LANG = { tr: 'listenTR.mp3', en: 'listenEN.mp3', ru: 'listenRU.mp3' };
    const LOCK_SECONDS = 5;
    let lockInterval = null;
    let lockTimeout = null;

    const fmt = (s) => {
      if (!isFinite(s) || s < 0) return '0:00';
      s = Math.floor(s);
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    };

    const setPlaying = (playing) => {
      playBtn.classList.toggle('playing', playing);
      playBtn.setAttribute('aria-label', tr(playing ? 'dlgate.pause' : 'dlgate.play'));
    };

    /* --- lock countdown --- */
    function clearLock() {
      clearInterval(lockInterval);
      clearTimeout(lockTimeout);
      lockInterval = null;
      lockTimeout = null;
    }
    function startLock() {
      clearLock();
      dl.classList.add('is-locked');
      let remaining = LOCK_SECONDS;
      countEl.textContent = remaining;

      lockFill.style.transition = 'none';
      lockFill.style.width = '0%';
      void lockFill.offsetWidth;            // force reflow so the fill animates from 0
      lockFill.style.transition = 'width ' + LOCK_SECONDS + 's linear';
      lockFill.style.width = '100%';

      lockInterval = setInterval(() => {
        remaining = Math.max(0, remaining - 1);
        countEl.textContent = remaining;
      }, 1000);
      lockTimeout = setTimeout(() => {
        clearInterval(lockInterval);
        dl.classList.remove('is-locked');
      }, LOCK_SECONDS * 1000);
    }

    /* --- open / close --- */
    function openGate() {
      const lang = document.documentElement.getAttribute('data-lang') || 'en';
      const file = AUDIO_BY_LANG[lang] || AUDIO_BY_LANG.en;
      const abs = new URL(file, location.href).href;
      if (audio.src !== abs) audio.src = file;

      dl.setAttribute('href', trigger.getAttribute('href'));

      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
      barFill.style.width = '0%';
      curEl.textContent = '0:00';
      durEl.textContent = fmt(audio.duration);

      gate.hidden = false;
      document.body.style.overflow = 'hidden';
      startLock();
      closeBtn.focus();
    }
    function closeGate() {
      audio.pause();
      setPlaying(false);
      clearLock();
      gate.hidden = true;
      document.body.style.overflow = '';
    }

    /* --- wiring --- */
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      openGate();
    });
    closeBtn.addEventListener('click', closeGate);
    gate.addEventListener('click', (e) => { if (e.target === gate) closeGate(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !gate.hidden) closeGate();
    });

    dl.addEventListener('click', (e) => {
      if (dl.classList.contains('is-locked')) { e.preventDefault(); return; }
      setTimeout(closeGate, 500);   // let the browser kick off the download first
    });

    playBtn.addEventListener('click', () => {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    });
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('ended', () => { setPlaying(false); });
    audio.addEventListener('loadedmetadata', () => { durEl.textContent = fmt(audio.duration); });
    audio.addEventListener('timeupdate', () => {
      curEl.textContent = fmt(audio.currentTime);
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      barFill.style.width = pct + '%';
    });

    bar.addEventListener('click', (e) => {
      if (!audio.duration) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      audio.currentTime = pct * audio.duration;
    });
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
    setupDownloadGate();
  });
})();
