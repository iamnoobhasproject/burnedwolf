/* ==========================================================================
   BURNEDWOLF — MAIN WINDOW
   --------------------------------------------------------------------------
   Every IPC channel below is unchanged from the working build; this file was
   rewritten for the Flat Weave world, not for new behaviour.
   ========================================================================== */
const { ipcRenderer, clipboard, shell } = require('electron');
const i18n = require('../i18n');
const { CHANGELOG_URL, UPDATE_MANIFEST_URL, WEBSITE_URL, SOURCE_URL } = require('../src/main/distribution');

const i18nReady = i18n.init();
i18nReady.then(() => { try { repaintDynamic(); } catch (e) {} });

const $ = (id) => document.getElementById(id);

function repaintDynamic() {
    highlightActiveLang();
    paintState();
    paintDns();
    paintTor();
    paintHealth();
}

// ==========================================
// --- WOVEN METER ---
// ==========================================
// Progress as discrete picks of weft. Cells are built once and only their
// class flips, so a progress update never touches layout.
function meter(el, frac, cells) {
    if (!el) return;
    const n = cells || 24;
    if (el.childElementCount !== n) {
        el.replaceChildren();
        for (let i = 0; i < n; i++) el.appendChild(document.createElement('i'));
    }
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * n);
    Array.from(el.children).forEach((c, i) => c.classList.toggle('f', i < filled));
}

// ==========================================
// --- THE LOOM (3D) ---
// ==========================================
const guard = LOOM.guard($('guardMotif'));
const bootLoom = LOOM.weave($('bootLoom'), { pps: 11 });

// ==========================================
// --- BOOT ---
// ==========================================
let booted = false;
const BOOT_STEPS = [['boot.init', .22], ['boot.engine', .55], ['boot.network', .84]];
i18nReady.then(function runBoot() {
    let i = 0;
    (function tick() {
        if (booted || i >= BOOT_STEPS.length) return;
        const [k, f] = BOOT_STEPS[i++];
        const s = document.querySelector('[data-boot-status]');
        if (s) s.textContent = i18n.t(k);
        meter($('bootMeter'), f, 20);
        setTimeout(tick, 240);
    })();
});
function finishBoot() {
    if (booted) return;
    booted = true;
    const s = document.querySelector('[data-boot-status]');
    if (s) s.textContent = i18n.t('boot.ready');
    meter($('bootMeter'), 1, 20);
    setTimeout(() => {
        $('bootScreen').classList.add('gone');
        LOOM.stop(bootLoom);
    }, 300);
}
setTimeout(finishBoot, 4200);

// ==========================================
// --- VIEWS ---
// ==========================================
const views = ['homeView', 'dnsView', 'analysisView', 'statsView', 'verifyView', 'advancedView', 'builderView', 'proxyView', 'bridgesView', 'settingsView'];
const RAIL_OF = { builderView: 'advancedView', proxyView: 'advancedView', bridgesView: 'advancedView' };
let currentView = 'homeView';

function showView(id) {
    if (!views.includes(id)) return;
    currentView = id;
    views.forEach(v => {
        const el = $(v);
        if (!el) return;
        const on = v === id;
        el.hidden = !on;
        if (on) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
    });
    const target = RAIL_OF[id] || id;
    document.querySelectorAll('.rbtn').forEach(b => b.classList.toggle('on', b.dataset.nav === target));

    if (id === 'dnsView') refreshDns();
    if (id === 'advancedView') reflectFailover();
    if (id === 'statsView') refreshStats();
    if (id === 'builderView') openBuilder();
    if (id === 'proxyView') openProxy();
    if (id === 'bridgesView') openBridges();
}

const rail = Array.from(document.querySelectorAll('.rbtn'));
rail.forEach((b, i) => {
    b.addEventListener('click', () => {
        if (b.id === 'btnBurnedCordRail') { ipcRenderer.send('open-burnedcord'); return; }
        showView(b.dataset.nav);
    });
    b.addEventListener('keydown', (e) => {
        let next = null;
        if (e.key === 'ArrowDown') next = rail[(i + 1) % rail.length];
        else if (e.key === 'ArrowUp') next = rail[(i - 1 + rail.length) % rail.length];
        else if (e.key === 'Home') next = rail[0];
        else if (e.key === 'End') next = rail[rail.length - 1];
        if (next) { e.preventDefault(); next.focus(); }
    });
});
document.querySelectorAll('.nav-back').forEach(b => b.addEventListener('click', () => showView('homeView')));
$('cardDns').addEventListener('click', () => showView('dnsView'));
$('cardBurnedCord').addEventListener('click', () => ipcRenderer.send('open-burnedcord'));
$('cardHealth').addEventListener('click', () => showView('analysisView'));
$('cardIntegrity').addEventListener('click', () => showView('verifyView'));

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if ($('notesOverlay').classList.contains('show')) { closeNotes(); return; }
        if (currentView !== 'homeView') showView('homeView');
    }
});
$('exit').addEventListener('click', () => ipcRenderer.send('minimize-window'));
$('btnMinimize').addEventListener('click', () => ipcRenderer.send('minimize-window'));

// ==========================================
// --- ENGINE STATE ---
// ==========================================
const stateText = $('stateText');
const stateSub = $('stateSub');
const btnPower = $('btnPower');
const btnPowerLabel = $('btnPowerLabel');
const profileSelect = $('profileSelect');
const btnAutoPick = $('btnAutoPick');

let engineRunning = false, engineMode = null, engineError = false;
let startedAt = null, lastHealth = null;
let profileLabels = {}, whitelistCache = '', savedCustomArgs = [], userProfilesMap = {};

const profileLabel = (id) => !id ? '' : (id === 'custom' ? (profileLabels.custom || 'Custom') : (profileLabels[id] || id.toUpperCase()));

function uptime() {
    if (!startedAt) return null;
    const m = Math.floor((Date.now() - startedAt) / 60000);
    const h = Math.floor(m / 60);
    return h > 0 ? i18n.t('home.uptime_hm', { h, m: m % 60 }) : i18n.t('home.uptime_m', { m });
}

function paintState() {
    stateText.textContent = i18n.t(engineError ? 'home.protection_err' : (engineRunning ? 'home.protection_on' : 'home.protection_off'));
    stateText.classList.toggle('on', engineRunning && !engineError);
    btnPowerLabel.textContent = i18n.t(engineRunning ? 'home.stop' : 'home.start');
    btnPower.classList.toggle('plain', engineRunning);
    if (guard) guard.set(engineRunning && !engineError);

    if (engineError) stateSub.textContent = i18n.t('home.err_sub');
    else if (engineRunning) {
        const parts = [i18n.t('home.profile_running', { p: profileLabel(engineMode) })];
        const u = uptime(); if (u) parts.push(u);
        stateSub.textContent = parts.join(' · ');
    } else stateSub.textContent = i18n.t('home.stopped_sub');

    profileSelect.disabled = engineRunning;
    btnAutoPick.disabled = engineRunning;
    $('btnChangeProfile').disabled = engineRunning;
    document.querySelector('.rbtn[data-nav="homeView"]').classList.toggle('hot', engineRunning);
    paintHealth();
}

function paintHealth() {
    const val = $('healthVal'), sub = $('healthSub');
    if (!engineRunning) { val.textContent = '—'; sub.textContent = i18n.t('home.health_idle'); return; }
    if (lastHealth && lastHealth.percent != null) {
        val.textContent = '%' + lastHealth.percent;
        sub.textContent = i18n.t('home.health_samples', { ok: lastHealth.ok, n: lastHealth.samples });
    } else {
        val.textContent = i18n.t('home.measuring');
        sub.textContent = i18n.t('home.health_wait');
    }
}

btnPower.addEventListener('click', () => {
    if (engineRunning) ipcRenderer.send('stop-zapret');
    else {
        engineError = false;
        const mode = profileSelect.value || 'bw_standard';
        ipcRenderer.send('start-zapret', {
            mode,
            customArgs: argsForProfile(mode),
            whitelistData: whitelistCache,
            failover: !!(failoverToggle && failoverToggle.checked && !failoverToggle.disabled)
        });
    }
    btnPower.disabled = true;
});

ipcRenderer.on('zapret-status', (e, status) => {
    if (status === 'running') {
        engineRunning = true; engineError = false;
        engineMode = profileSelect.value || engineMode;
        if (!startedAt) startedAt = Date.now();
    } else if (status === 'error') {
        engineRunning = false; engineError = true; startedAt = null; lastHealth = null;
    } else {
        engineRunning = false; engineMode = null; startedAt = null; lastHealth = null;
    }
    btnPower.disabled = false;
    paintState();
});

setInterval(async () => {
    if (!engineRunning) return;
    try {
        const h = await ipcRenderer.invoke('get-engine-health');
        lastHealth = (h && h.percent != null) ? h : null;
    } catch (e) {}
    paintState();
}, 15000);

// ==========================================
// --- PROFILE + ISP ---
// ==========================================
const ispText = $('ispText');
let detectedISP = null, recommended = [];

$('btnChangeProfile').addEventListener('click', () => {
    const w = $('profileWrap');
    const open = w.classList.toggle('show');
    $('btnChangeProfile').textContent = i18n.t(open ? 'home.done' : 'home.change');
    if (open) profileSelect.focus();
});

function paintProfileName() {
    $('profileName').textContent = profileLabel(profileSelect.value) || '—';
}

async function loadProfiles() {
    try {
        const profiles = await ipcRenderer.invoke('get-dpi-profiles');
        if (!Array.isArray(profiles)) return;
        profileSelect.replaceChildren();
        const order = ['Generic', 'Turkey', 'Russia', 'Europe', 'Middle East', 'Asia'];
        const groups = new Map(); const seen = [];
        for (const p of profiles) {
            profileLabels[p.id] = p.label;
            if (!groups.has(p.region)) { groups.set(p.region, []); seen.push(p.region); }
            groups.get(p.region).push(p);
        }
        const regions = order.filter(r => groups.has(r)).concat(seen.filter(r => !order.includes(r)));
        for (const region of regions) {
            const og = document.createElement('optgroup');
            og.label = region;
            for (const p of groups.get(region)) {
                const o = document.createElement('option');
                o.value = p.id; o.textContent = p.label;
                og.appendChild(o);
            }
            profileSelect.appendChild(og);
        }
        decorate();
        const saved = await ipcRenderer.invoke('settings-get', 'last_profile');
        const target = engineMode || saved;
        profileSelect.value = (target && (profileLabels[target] || target === 'custom')) ? target : 'bw_standard';
        paintProfileName();
        paintState();
    } catch (e) {}
}

function decorate() {
    Array.from(profileSelect.querySelectorAll('option')).forEach(o => {
        const base = profileLabels[o.value] || o.textContent.replace(/^★\s*/, '');
        o.textContent = (recommended.includes(o.value) ? '★ ' : '') + base;
    });
}

profileSelect.addEventListener('change', () => {
    ipcRenderer.invoke('settings-set', 'last_profile', profileSelect.value);
    paintProfileName();
});

async function detectISP() {
    try {
        const r = await ipcRenderer.invoke('detect-isp', {});
        detectedISP = r;
        if (r && r.detected) {
            ispText.textContent = r.asn ? `${r.ispLabel} · AS${r.asn}` : r.ispLabel;
            recommended = Array.isArray(r.recommendedProfiles) ? r.recommendedProfiles.slice() : [];
            decorate();
            paintProfileName();
        } else ispText.textContent = i18n.t('home.isp_unknown');
    } catch (e) { ispText.textContent = i18n.t('home.isp_unknown'); }
    reflectFailover();
}

btnAutoPick.addEventListener('click', () => {
    if (engineRunning) return;
    const recs = recommended.filter(id => profileLabels[id]);
    if (recs.length) {
        profileSelect.value = recs[0];
        ipcRenderer.invoke('settings-set', 'last_profile', recs[0]);
        paintProfileName();
    } else ispText.textContent = i18n.t('home.isp_unknown');
});

// ==========================================
// --- WHITELIST ---
// ==========================================
ipcRenderer.on('whitelist-data', (e, data) => {
    whitelistCache = data || '';
    const ta = $('whitelistInput');
    if (ta && document.activeElement !== ta) ta.value = whitelistCache;
});
ipcRenderer.send('load-whitelist');

// ==========================================
// --- DNS ---
// ==========================================
const dohToggle = $('dohToggle');
let dnsStatus = null;

const DNS_PRESETS = [
    { key: 'cloudflare', name: 'Cloudflare', meta: '1.1.1.1' },
    { key: 'google', name: 'Google', meta: '8.8.8.8' },
    { key: 'quad9', name: 'Quad9', meta: '9.9.9.9' },
    { key: 'adguard', name: 'AdGuard', meta: '94.140.14.14' }
];

function buildPresets() {
    const box = $('dnsPresets');
    if (!box || box.childElementCount) return;
    DNS_PRESETS.forEach(p => {
        const row = document.createElement('label');
        row.className = 'preset';
        row.innerHTML = `<input type="radio" name="dns-pick" value="${p.key}"><span class="pn"></span><span class="pm"></span>`;
        row.querySelector('.pn').textContent = p.name;
        row.querySelector('.pm').textContent = p.meta;
        row.addEventListener('click', () => setTimeout(syncPresets, 0));
        row.querySelector('input').addEventListener('change', async () => {
            await ipcRenderer.invoke('apply-dns-preset', p.key);
            pushLog(`[DNS] ${p.name} (${p.meta})`);
            await refreshDns();
        });
        box.appendChild(row);
    });
}
function syncPresets() {
    document.querySelectorAll('#dnsPresets .preset').forEach(r => r.classList.toggle('on', r.querySelector('input').checked));
}

function paintDns() {
    const val = $('dnsVal'), sub = $('dnsSub'), pill = $('dnsStatePill'), cur = $('dnsCurrent');
    if (!dnsStatus) { val.textContent = '—'; sub.textContent = ''; return; }
    if (dnsStatus.isEncrypted) {
        val.textContent = i18n.t('home.on');
        sub.textContent = i18n.t('home.dns_active');
        if (pill) { pill.textContent = 'DoH'; pill.className = 'tag on'; }
        if (cur) cur.textContent = i18n.t('home.dns_active');
    } else {
        const p = dnsStatus.provider || (dnsStatus.isISP ? i18n.t('home.dns_isp_default') : (dnsStatus.raw || '—'));
        val.textContent = p;
        sub.textContent = i18n.t(dnsStatus.isISP ? 'home.dns_isp_warn' : 'home.dns_plain');
        if (pill) { pill.textContent = dnsStatus.isISP ? i18n.t('home.dns_isp_default') : 'OK'; pill.className = 'tag ' + (dnsStatus.isISP ? 'warn' : 'ok'); }
        if (cur) cur.textContent = dnsStatus.provider || ((dnsStatus.ipv4 && dnsStatus.ipv4.length) ? dnsStatus.ipv4.join(', ') : '—');
    }
    if (dohToggle) dohToggle.checked = !!dnsStatus.isEncrypted;
}

async function refreshDns() {
    buildPresets();
    try { dnsStatus = await ipcRenderer.invoke('get-dns-status'); } catch (e) {}
    paintDns();
}

dohToggle.addEventListener('change', async () => {
    dohToggle.disabled = true;
    try {
        if (dohToggle.checked) {
            const r = await ipcRenderer.invoke('start-encrypted-dns');
            if (r && !r.ok && r.error === 'binary_missing') $('dnsCurrent').textContent = i18n.t('home.dns_missing');
        } else await ipcRenderer.invoke('stop-encrypted-dns');
    } catch (e) {}
    await refreshDns();
    dohToggle.disabled = false;
});

$('btnDnsDhcp').addEventListener('click', async () => {
    await ipcRenderer.invoke('apply-dns-preset', 'dhcp');
    pushLog('[DNS] DHCP');
    document.querySelectorAll('#dnsPresets input').forEach(i => { i.checked = false; });
    syncPresets();
    await refreshDns();
});

ipcRenderer.on('encrypted-dns-status', () => refreshDns());
setInterval(() => { if (!$('dnsView').hidden) refreshDns(); }, 30000);

// ==========================================
// --- DoH RESIDUE ---
// ==========================================
const notice = $('dnsNotice');
function showNotice(kind, titleKey, textKey, args) {
    notice.classList.add('show');
    notice.classList.toggle('good', kind === 'ok');
    $('dnsNoticeTitle').textContent = i18n.t(titleKey, args);
    $('dnsNoticeText').textContent = i18n.t(textKey, args);
    $('btnFixResidue').style.display = kind === 'ok' ? 'none' : '';
    if (kind === 'ok') setTimeout(() => notice.classList.remove('show'), 7000);
}

ipcRenderer.on('dns-preflight-result', (e, r) => {
    if (!r) return;
    if (r.state === 'repaired') {
        const names = (r.adaptersFixed || []).join(', ');
        showNotice('ok', 'dnsfix.fixed_title', 'dnsfix.fixed_text', { a: names || '—' });
        pushLog(`[DNS] ${i18n.t('dnsfix.log_fixed')}${names ? ' — ' + names : ''}`);
    } else if (r.state === 'failed' || r.state === 'residue') {
        const partial = r.scan && r.scan.severity === 'partial';
        showNotice('warn', 'dnsfix.banner_title', partial ? 'dnsfix.banner_text_partial' : 'dnsfix.banner_text');
        pushLog('[DNS] ' + i18n.t('dnsfix.log_stranded'));
    } else notice.classList.remove('show');
    refreshDns();
});

async function runFix(btn) {
    const label = btn.textContent;
    btn.disabled = true; btn.classList.add('busy'); btn.textContent = i18n.t('dnsfix.working');
    try {
        const r = await ipcRenderer.invoke('dns-residue-fix');
        if (r && r.ok && r.repaired) showNotice('ok', 'dnsfix.fixed_title', 'dnsfix.fixed_text', { a: (r.adaptersFixed || []).join(', ') || '—' });
        else if (r && r.ok) showNotice('ok', 'dnsfix.none_title', 'dnsfix.none_text');
        else showNotice('warn', 'dnsfix.failed_title', 'dnsfix.failed_text');
    } catch (e) { showNotice('warn', 'dnsfix.failed_title', 'dnsfix.failed_text'); }
    btn.disabled = false; btn.classList.remove('busy'); btn.textContent = label;
    refreshDns();
}
$('btnFixResidue').addEventListener('click', (e) => runFix(e.currentTarget));
$('btnFixResidue2').addEventListener('click', (e) => runFix(e.currentTarget));

(async () => {
    try {
        const last = await ipcRenderer.invoke('dns-preflight-last');
        if (last && (last.state === 'failed' || last.state === 'residue')) showNotice('warn', 'dnsfix.banner_title', 'dnsfix.banner_text');
        else if (last && last.state === 'repaired') pushLog('[DNS] ' + i18n.t('dnsfix.log_fixed'));
    } catch (e) {}
})();

// ==========================================
// --- TOR readout (advanced proxy tools only) ---
// ==========================================
let torReady = false;
function paintTor() { if (currentView === 'proxyView') { try { refreshProxy(); } catch (e) {} } }
ipcRenderer.on('tor-ready', () => { torReady = true; paintTor(); });

// ==========================================
// --- ANALYSIS ---
// ==========================================
const scanTerm = $('scanTerm');
const btnRunScan = $('btnRunScan'), btnCancelScan = $('btnCancelScan'), btnReport = $('btnReport');
let scanMode = 'quick', analysisLogs = [];

$('segQuick').addEventListener('click', () => setScanMode('quick'));
$('segDeep').addEventListener('click', () => setScanMode('deep'));
function setScanMode(m) {
    scanMode = m;
    $('segQuick').classList.toggle('on', m === 'quick');
    $('segDeep').classList.toggle('on', m === 'deep');
}

function clearEmpty(el) { const e = el.querySelector('.log-empty'); if (e) e.remove(); }

function scanLog(msg) {
    clearEmpty(scanTerm);
    const d = document.createElement('div');
    d.className = 'l';
    d.textContent = msg;
    if (/FATAL|ERROR|✗|FAILED/.test(msg)) d.classList.add('bad');
    else if (/PERFECT|APPLIED|✓ full|\[VOICE\]/.test(msg)) d.classList.add('ok');
    scanTerm.appendChild(d);
    scanTerm.scrollTop = scanTerm.scrollHeight;
    analysisLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function startScan() {
    scanTerm.replaceChildren();
    analysisLogs = [];
    $('topResults').style.display = 'none';
    $('topResults').replaceChildren();
    btnReport.style.display = 'none';
    btnRunScan.style.display = 'none';
    btnCancelScan.style.display = 'inline-flex';
    btnCancelScan.disabled = false;
    btnCancelScan.textContent = i18n.t('analysis.cancel');
    $('scanProgress').style.display = 'block';
    $('scanPhase').textContent = i18n.t('analysis.initializing');
    $('scanCount').textContent = '0 / 0';
    meter($('scanMeter'), 0, 30);
    $('scanTarget').textContent = '—';
    ipcRenderer.send('run-blockcheck', { mode: scanMode });
}
btnRunScan.addEventListener('click', startScan);
btnCancelScan.addEventListener('click', () => {
    btnCancelScan.disabled = true;
    btnCancelScan.textContent = i18n.t('analysis.cancelling');
    ipcRenderer.send('cancel-blockcheck');
});
function resetScan() { btnRunScan.style.display = 'inline-flex'; btnCancelScan.style.display = 'none'; }

ipcRenderer.on('blockcheck-log', (e, m) => scanLog(m));
ipcRenderer.on('blockcheck-progress', (e, d) => {
    if (!d) return;
    if (d.phase === 'phase1') $('scanPhase').textContent = i18n.t('analysis.phase1');
    else if (d.phase === 'phase2') $('scanPhase').textContent = i18n.t('analysis.phase2');
    if (typeof d.current === 'number' && typeof d.total === 'number' && d.total > 0) {
        $('scanCount').textContent = `${d.current} / ${d.total}`;
        meter($('scanMeter'), d.current / d.total, 30);
    }
    if (d.label) $('scanTarget').textContent = d.label;
});

function renderTop(top) {
    if (!Array.isArray(top) || !top.length) return;
    const box = $('topResults');
    box.replaceChildren();
    top.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'rank' + (i === 0 ? ' first' : '');
        row.innerHTML = `<span class="n">${i + 1}</span><span class="rb"><span class="rn"></span><span class="rm"><span class="num"></span><span class="${p.voice ? 'y' : 'n2'}"></span><span class="vd"></span></span></span>`;
        row.querySelector('.rn').textContent = p.name;
        row.querySelector('.num').textContent = `${p.score}/5 TCP`;
        row.querySelector(p.voice ? '.y' : '.n2').textContent = i18n.t(p.voice ? 'analysis.voice_ok' : 'analysis.voice_no');
        row.querySelector('.vd').textContent = p.vendor || '';
        box.appendChild(row);
    });
    box.style.display = 'block';
}

ipcRenderer.on('blockcheck-done', (e, data) => {
    localStorage.setItem('bw_custom_profile', JSON.stringify(data));
    loadCustom();
    profileSelect.value = 'custom';
    ipcRenderer.invoke('settings-set', 'last_profile', 'custom');
    paintProfileName();
    if (data.voice === true) scanLog('[VOICE] Profile supports Discord voice (UDP verified)');
    else if (data.voice === false) scanLog('[VOICE WARNING] Web-only — Discord calls may hang');
    renderTop(data.topProfiles);
    $('scanPhase').textContent = i18n.t('analysis.complete');
    meter($('scanMeter'), 1, 30);
    resetScan();
    btnReport.style.display = 'inline-flex';
});
ipcRenderer.on('blockcheck-status', (e, s) => {
    if (s === 'done') { resetScan(); $('scanProgress').style.display = 'none'; btnReport.style.display = 'inline-flex'; }
});

btnReport.addEventListener('click', () => {
    ipcRenderer.send('save-analysis-report',
        `=============================================\nBURNEDWOLF NETWORK ANALYSIS REPORT\nDate: ${new Date().toLocaleString()}\n=============================================\n\n` +
        analysisLogs.join('\n') + `\n\n=============================================\nBurnedWolf\n`);
});

function loadCustom() {
    const raw = localStorage.getItem('bw_custom_profile');
    let opt = profileSelect.querySelector('option[value="custom"]');
    if (raw) {
        try {
            const p = JSON.parse(raw);
            savedCustomArgs = p.args || [];
            profileLabels.custom = p.name || 'Custom';
            if (!opt) { opt = document.createElement('option'); opt.value = 'custom'; profileSelect.appendChild(opt); }
            opt.textContent = profileLabels.custom;
        } catch (e) {}
    } else if (opt) opt.remove();
}

// ==========================================
// --- PROFILE BUILDER ---
// ==========================================
// User-built DPI profiles live in localStorage 'bw_user_profiles' as
// [{ id, name, args:[] }]. They show in the main profile dropdown under
// "My profiles" and, when started, carry their own argv to the engine (which
// keeps the id for stats). The legacy scan-generated 'custom' slot is untouched.
function readUserProfiles() {
    try { const l = JSON.parse(localStorage.getItem('bw_user_profiles') || '[]'); return Array.isArray(l) ? l : []; }
    catch (e) { return []; }
}
function writeUserProfiles(list) {
    try { localStorage.setItem('bw_user_profiles', JSON.stringify(list)); } catch (e) {}
}

// Register saved user profiles: dropdown optgroup + label map + args map.
function loadUserProfiles() {
    userProfilesMap = {};
    const prev = profileSelect.querySelector('optgroup[data-user="1"]');
    if (prev) prev.remove();
    const list = readUserProfiles();
    if (!list.length) return list;
    const og = document.createElement('optgroup');
    og.label = i18n.t('builder.my_profiles');
    og.dataset.user = '1';
    list.forEach(p => {
        if (!p || !p.id) return;
        userProfilesMap[p.id] = { name: p.name || 'Custom', args: Array.isArray(p.args) ? p.args : [] };
        profileLabels[p.id] = p.name || 'Custom';
        const o = document.createElement('option');
        o.value = p.id; o.textContent = p.name || 'Custom';
        og.appendChild(o);
    });
    profileSelect.appendChild(og);
    return list;
}

// argv a profile id should start with; null = resolve from the built-in catalog.
function argsForProfile(id) {
    if (id === 'custom') return savedCustomArgs;
    if (userProfilesMap[id]) return userProfilesMap[id].args;
    return null;
}

let bpEditingId = null;   // set when editing an existing saved profile

function tokenizeArgs(text) {
    return String(text || '').split(/\s+/).map(t => t.trim()).filter(Boolean);
}

function bpAnalyze(tokens) {
    const argStr = tokens.join(' ');
    const chains = tokens.filter(t => t === '--new').length + (tokens.length ? 1 : 0);
    const voice = argStr.includes('--filter-udp=50000-65535') || argStr.includes('--dpi-desync-any-protocol');
    const hasWf = tokens.some(t => t.startsWith('--wf-tcp') || t.startsWith('--wf-udp'));
    const hasDesync = tokens.some(t => t.startsWith('--dpi-desync'));
    const bad = tokens.filter(t => !t.startsWith('--'));
    return { chains, voice, hasWf, hasDesync, bad };
}

function bpRenderSummary() {
    if (!$('bpArgs')) return;
    const tokens = tokenizeArgs($('bpArgs').value);
    const a = bpAnalyze(tokens);
    const box = $('bpSummary');
    const warn = a.bad.length || !a.hasWf || !a.hasDesync;
    if (box) box.classList.toggle('warn', !!warn);
    $('bpSummaryTitle').textContent = i18n.t('builder.summary_title', { chains: a.chains, n: tokens.length });
    const parts = [ a.voice ? i18n.t('builder.voice_yes') : i18n.t('builder.voice_no') ];
    if (!a.hasWf) parts.push(i18n.t('builder.warn_nowf'));
    if (!a.hasDesync) parts.push(i18n.t('builder.warn_nodesync'));
    if (a.bad.length) parts.push(i18n.t('builder.warn_badtokens', { t: a.bad.slice(0, 3).join(', ') }));
    $('bpSummaryText').textContent = parts.join(' · ');
}

const BP_CHIPS = [
    '--new',
    '--wf-tcp=80,443', '--wf-udp=443,50000-65535',
    '--filter-tcp=80,443', '--filter-tcp=443', '--filter-udp=443', '--filter-udp=50000-65535',
    '--dpi-desync=fake', '--dpi-desync=split2', '--dpi-desync=fake,split2', '--dpi-desync=fake,disorder2', '--dpi-desync=fake,multisplit',
    '--dpi-desync-fooling=md5sig', '--dpi-desync-fooling=md5sig,badseq',
    '--dpi-desync-autottl=2', '--dpi-desync-repeats=6', '--dpi-desync-split-pos=2', '--dpi-desync-any-protocol'
];

function bpBuildChips() {
    const box = $('bpChips');
    if (!box || box.childElementCount) return; // build once
    BP_CHIPS.forEach(flag => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = flag === '--new' ? i18n.t('builder.new_chain') : flag;
        b.title = flag;
        b.addEventListener('click', () => {
            const ta = $('bpArgs');
            const cur = ta.value.replace(/\s+$/, '');
            ta.value = (cur ? cur + '\n' : '') + flag + '\n';
            bpRenderSummary();
        });
        box.appendChild(b);
    });
}

function bpFillCloneOptions() {
    const sel = $('bpClone');
    if (!sel) return;
    sel.replaceChildren();
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = i18n.t('builder.clone_blank');
    sel.appendChild(blank);
    Object.keys(profileLabels).forEach(id => {
        if (id === 'custom' || userProfilesMap[id]) return; // built-ins only
        const o = document.createElement('option');
        o.value = id; o.textContent = profileLabels[id];
        sel.appendChild(o);
    });
}

function bpRenderList() {
    const box = $('bpList');
    if (!box) return;
    box.replaceChildren();
    const list = readUserProfiles();
    if (!list.length) {
        const e = document.createElement('div');
        e.className = 'rank-empty'; e.textContent = i18n.t('builder.none');
        box.appendChild(e);
        return;
    }
    list.forEach(p => {
        const row = document.createElement('div');
        row.className = 'rank';
        const rb = document.createElement('div'); rb.className = 'rb';
        const rn = document.createElement('div'); rn.className = 'rn'; rn.textContent = p.name || 'Custom';
        const rm = document.createElement('div'); rm.className = 'rm';
        const meta = document.createElement('span'); meta.textContent = i18n.t('builder.list_meta', { n: (p.args || []).length });
        rm.appendChild(meta);
        rb.append(rn, rm);
        const actions = document.createElement('div');
        actions.style.marginLeft = 'auto'; actions.style.display = 'flex'; actions.style.gap = 'var(--s2)';
        const useB = document.createElement('button'); useB.className = 'act plain sm'; useB.textContent = i18n.t('builder.use');
        useB.addEventListener('click', () => bpUse(p.id));
        const editB = document.createElement('button'); editB.className = 'act plain sm'; editB.textContent = i18n.t('builder.edit');
        editB.addEventListener('click', () => bpEdit(p.id));
        actions.append(useB, editB);
        row.append(rb, actions);
        box.appendChild(row);
    });
}

function openBuilder() {
    bpBuildChips();
    bpFillCloneOptions();
    bpRenderList();
    bpRenderSummary();
}

function bpNew() {
    bpEditingId = null;
    if ($('bpName')) $('bpName').value = '';
    if ($('bpArgs')) $('bpArgs').value = '';
    if ($('btnDeleteProfile')) $('btnDeleteProfile').style.display = 'none';
    if ($('bpStatus')) $('bpStatus').textContent = '';
    bpRenderSummary();
}

function bpEdit(id) {
    const p = readUserProfiles().find(x => x.id === id);
    if (!p) return;
    bpEditingId = id;
    $('bpName').value = p.name || '';
    $('bpArgs').value = (p.args || []).join('\n');
    $('btnDeleteProfile').style.display = '';
    $('bpStatus').textContent = '';
    bpRenderSummary();
    showView('builderView');
}

function bpUse(id) {
    loadUserProfiles();
    if (profileLabels[id] || id === 'custom') {
        profileSelect.value = id;
        ipcRenderer.invoke('settings-set', 'last_profile', id);
        paintProfileName();
    }
    showView('homeView');
}

function bpSave(useAfter) {
    const name = ($('bpName').value || '').trim();
    const args = tokenizeArgs($('bpArgs').value);
    if (!name) { $('bpStatus').textContent = i18n.t('builder.need_name'); return null; }
    if (!args.length) { $('bpStatus').textContent = i18n.t('builder.need_args'); return null; }
    const list = readUserProfiles();
    let id = bpEditingId;
    if (id) {
        const idx = list.findIndex(x => x.id === id);
        if (idx >= 0) list[idx] = { id, name, args }; else list.push({ id, name, args });
    } else {
        id = 'user_' + Date.now().toString(36);
        list.push({ id, name, args });
        bpEditingId = id;
    }
    writeUserProfiles(list);
    loadUserProfiles();
    if ($('btnDeleteProfile')) $('btnDeleteProfile').style.display = '';
    $('bpStatus').textContent = i18n.t('builder.saved');
    bpRenderList();
    if (useAfter) bpUse(id);
    return id;
}

function bpDelete() {
    if (!bpEditingId) return;
    const deleted = bpEditingId;
    writeUserProfiles(readUserProfiles().filter(x => x.id !== deleted));
    loadUserProfiles();
    if (profileSelect.value === deleted) {
        profileSelect.value = 'bw_standard';
        ipcRenderer.invoke('settings-set', 'last_profile', 'bw_standard');
        paintProfileName();
    }
    bpNew();
    bpRenderList();
}

// --- builder wiring ---
if ($('btnOpenBuilder')) $('btnOpenBuilder').addEventListener('click', () => { bpNew(); showView('builderView'); });
if ($('bpArgs')) $('bpArgs').addEventListener('input', bpRenderSummary);
if ($('btnCloneLoad')) $('btnCloneLoad').addEventListener('click', async () => {
    const id = $('bpClone').value;
    if (!id) return;
    let args = null;
    try { args = await ipcRenderer.invoke('get-profile-args', id); } catch (e) {}
    if (Array.isArray(args)) {
        $('bpArgs').value = args.join('\n');
        if (!$('bpName').value.trim()) $('bpName').value = (profileLabels[id] || id) + ' (copy)';
        bpRenderSummary();
    }
});
if ($('btnSaveProfile')) $('btnSaveProfile').addEventListener('click', () => bpSave(false));
if ($('btnSaveUseProfile')) $('btnSaveUseProfile').addEventListener('click', () => bpSave(true));
if ($('btnDeleteProfile')) $('btnDeleteProfile').addEventListener('click', bpDelete);
if ($('btnExportProfile')) $('btnExportProfile').addEventListener('click', async () => {
    const name = ($('bpName').value || '').trim() || 'Custom';
    const args = tokenizeArgs($('bpArgs').value);
    if (!args.length) { $('bpStatus').textContent = i18n.t('builder.need_args'); return; }
    let r = null;
    try { r = await ipcRenderer.invoke('profile-export', { name, args }); } catch (e) {}
    if (r && r.ok) $('bpStatus').textContent = i18n.t('builder.export_ok');
    else if (r && r.canceled) $('bpStatus').textContent = '';
    else $('bpStatus').textContent = i18n.t('builder.op_failed');
});
if ($('btnImportProfile')) $('btnImportProfile').addEventListener('click', async () => {
    let r = null;
    try { r = await ipcRenderer.invoke('profile-import'); } catch (e) {}
    if (r && r.ok) {
        bpEditingId = null;
        $('bpName').value = r.name || 'Imported';
        $('bpArgs').value = (r.args || []).join('\n');
        if ($('btnDeleteProfile')) $('btnDeleteProfile').style.display = 'none';
        $('bpStatus').textContent = i18n.t('builder.import_ok');
        bpRenderSummary();
    } else if (r && r.canceled) {
        $('bpStatus').textContent = '';
    } else if (r && r.error === 'invalid') {
        $('bpStatus').textContent = i18n.t('builder.import_invalid');
    } else {
        $('bpStatus').textContent = i18n.t('builder.op_failed');
    }
});

// ==========================================
// --- ADVANCED ---
// ==========================================
const failoverToggle = $('failoverToggle'), trMasterToggle = $('trMasterToggle');

(async () => {
    try { failoverToggle.checked = (await ipcRenderer.invoke('settings-get', 'dpi_failover')) === true; } catch (e) {}
    try {
        const s = await ipcRenderer.invoke('settings-get', 'dpi_use_tr_master_list');
        trMasterToggle.checked = s === undefined ? true : s === true;
    } catch (e) { trMasterToggle.checked = true; }
    try {
        const info = await ipcRenderer.invoke('get-tr-master-info');
        if (info && typeof info.count === 'number') $('trMasterCount').textContent = i18n.t('adv.trmaster_count', { n: info.count });
    } catch (e) {}
})();

failoverToggle.addEventListener('change', e => ipcRenderer.invoke('settings-set', 'dpi_failover', e.target.checked));
trMasterToggle.addEventListener('change', e => ipcRenderer.invoke('settings-set', 'dpi_use_tr_master_list', e.target.checked));

function reflectFailover() {
    const chain = Array.isArray(recommended) && recommended.length > 1;
    failoverToggle.disabled = !chain;
    if (!chain) { failoverToggle.checked = false; $('failoverHint').textContent = i18n.t('adv.failover_unavailable'); }
    else $('failoverHint').textContent = i18n.t('adv.failover_ready', { n: recommended.length });
}

$('btnSaveWhitelist').addEventListener('click', () => {
    const ta = $('whitelistInput');
    whitelistCache = ta.value;
    ipcRenderer.send('save-whitelist-only', ta.value);
    const t = $('saveToast');
    t.style.display = 'inline';
    setTimeout(() => t.style.display = 'none', 2000);
});

// ==========================================
// --- LOG ---
// ==========================================
const LOG_MAX = 150;
let logLines = [];
function pushLog(msg) {
    const d = new Date();
    const p = `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`;
    String(msg).split('\n').map(l => l.trim()).filter(Boolean).forEach(l => logLines.push(`${p} ${l}`));
    if (logLines.length > LOG_MAX) logLines = logLines.slice(-LOG_MAX);
    $('logLine').textContent = logLines[logLines.length - 1] || i18n.t('home.log_empty');
    if (!$('logPanel').hidden) { $('logBuf').textContent = logLines.join('\n'); $('logPanel').scrollTop = $('logPanel').scrollHeight; }
}
$('logBar').addEventListener('click', () => {
    const p = $('logPanel');
    p.hidden = !p.hidden;
    if (!p.hidden) { $('logBuf').textContent = logLines.join('\n') || i18n.t('home.log_empty'); p.scrollTop = p.scrollHeight; }
});
ipcRenderer.on('zapret-log', (e, m) => pushLog(m));
ipcRenderer.on('tor-log', (e, m) => { if (String(m).includes('Bootstrapped')) pushLog(m); });


// Official product links live in the central distribution config.
$('btnOpenWebsite')?.addEventListener('click', () => shell.openExternal(WEBSITE_URL));
$('btnOpenSource')?.addEventListener('click', () => shell.openExternal(SOURCE_URL));

// ==========================================
// --- UPDATE NOTES ---
// ==========================================
const notesOverlay = $('notesOverlay');
function closeNotes() { notesOverlay.classList.remove('show'); }
$('notesClose').addEventListener('click', closeNotes);
notesOverlay.addEventListener('click', e => { if (e.target === notesOverlay) closeNotes(); });

async function maybeNotes() {
    let on = true;
    try { on = (await ipcRenderer.invoke('settings-get', 'show_update_notes')) !== false; } catch (e) {}
    if (!on) return false;
    try {
        const res = await fetch(CHANGELOG_URL + '?t=' + Date.now());
        const lines = (await res.text()).split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return false;
        const body = $('notesBody');
        body.replaceChildren();
        lines.forEach(l => {
            const it = document.createElement('div');
            it.style.cssText = 'display:flex;gap:10px;padding:5px 0;font-size:13px;line-height:1.5;';
            it.innerHTML = '<span style="width:5px;height:5px;background:var(--madder);margin-top:8px;flex-shrink:0;"></span><span></span>';
            it.querySelector('span:last-child').textContent = l;
            body.appendChild(it);
        });
        try {
            const v = await (await fetch(UPDATE_MANIFEST_URL + '?t=' + Date.now())).json();
            if (v && v.version) $('notesVersion').textContent = 'v' + v.version;
        } catch (e) {}
        notesOverlay.classList.add('show');
        return true;
    } catch (e) {}
    return false;
}

// ==========================================
// --- VERSION + SETTINGS ---
// ==========================================
ipcRenderer.on('app-version', (e, v) => {
    $('versionDisplay').textContent = v;
    $('verChip').textContent = 'v' + v;
    localStorage.setItem('bw_current_version', v);
});

function highlightActiveLang() {
    const cur = i18n.getLang();
    document.querySelectorAll('.lang-pill').forEach(b => b.classList.toggle('on', b.dataset.lang === cur));
}
document.querySelectorAll('.lang-pill').forEach(b => b.addEventListener('click', async () => {
    await ipcRenderer.invoke('settings-set', 'language', b.dataset.lang);
    highlightActiveLang();
}));
highlightActiveLang();
ipcRenderer.on('language-changed', () => repaintDynamic());

const autoStartToggle = $('autoStartToggle');
(async () => {
    const on = (await ipcRenderer.invoke('settings-get', 'autostart')) === true;
    autoStartToggle.checked = on;
    ipcRenderer.send('set-autostart', on);
})();
autoStartToggle.addEventListener('change', async e => {
    await ipcRenderer.invoke('settings-set', 'autostart', e.target.checked);
    ipcRenderer.send('set-autostart', e.target.checked);
});

const autoUpdateToggle = $('autoUpdateToggle');
(async () => { const s = await ipcRenderer.invoke('settings-get', 'auto_update'); autoUpdateToggle.checked = s === undefined ? true : s === true; })();
autoUpdateToggle.addEventListener('change', e => ipcRenderer.invoke('settings-set', 'auto_update', e.target.checked));

const updateNotesToggle = $('updateNotesToggle');
(async () => { const s = await ipcRenderer.invoke('settings-get', 'show_update_notes'); updateNotesToggle.checked = s === undefined ? true : s === true; })();
updateNotesToggle.addEventListener('change', e => ipcRenderer.invoke('settings-set', 'show_update_notes', e.target.checked));

// --- Manual "check for updates" + background-check badge ---
// The main process owns the actual version check (updater.js). Here we drive the
// Settings button and reflect a pending update as a rail badge + "Install now".
const btnCheckUpdate    = $('btnCheckUpdate');
const btnInstallUpdate  = $('btnInstallUpdate');
const checkUpdateStatus = $('checkUpdateStatus');

function setSettingsUpdateBadge(on) {
    const navBtn = document.querySelector('.rbtn[data-nav="settingsView"]');
    if (navBtn) navBtn.classList.toggle('has-update', !!on);
}
function markUpdateAvailable(v) {
    if (checkUpdateStatus) checkUpdateStatus.textContent = i18n.t('settings.update_found', { v });
    if (btnInstallUpdate) btnInstallUpdate.hidden = false;
    setSettingsUpdateBadge(true);
}

if (btnCheckUpdate) btnCheckUpdate.addEventListener('click', async () => {
    btnCheckUpdate.disabled = true;
    if (checkUpdateStatus) checkUpdateStatus.textContent = i18n.t('settings.checking');
    let r = null;
    try { r = await ipcRenderer.invoke('check-update-now'); } catch (e) {}
    btnCheckUpdate.disabled = false;
    if (!r || r.state === 'error') { if (checkUpdateStatus) checkUpdateStatus.textContent = i18n.t('settings.check_failed'); return; }
    if (r.state === 'update') {
        markUpdateAvailable(r.new);
    } else {
        if (checkUpdateStatus) checkUpdateStatus.textContent = i18n.t('settings.up_to_date');
        if (btnInstallUpdate) btnInstallUpdate.hidden = true;
        setSettingsUpdateBadge(false);
    }
});

if (btnInstallUpdate) btnInstallUpdate.addEventListener('click', () => ipcRenderer.send('open-updater-window'));

// The background checker in main broadcasts this when it finds a newer build.
ipcRenderer.on('update-available-bg', (e, info) => { if (info && info.new) markUpdateAvailable(info.new); });

// --- Config backup: export / import (main: backup.js) ---
const btnExportConfig = $('btnExportConfig');
const btnImportConfig = $('btnImportConfig');
const backupStatus    = $('backupStatus');

if (btnExportConfig) btnExportConfig.addEventListener('click', async () => {
    btnExportConfig.disabled = true;
    let r = null;
    try { r = await ipcRenderer.invoke('config-export'); } catch (e) {}
    btnExportConfig.disabled = false;
    if (r && r.ok) backupStatus.textContent = i18n.t('settings.export_ok');
    else if (r && r.canceled) backupStatus.textContent = '';
    else backupStatus.textContent = i18n.t('settings.backup_failed');
});

if (btnImportConfig) btnImportConfig.addEventListener('click', async () => {
    btnImportConfig.disabled = true;
    let r = null;
    try { r = await ipcRenderer.invoke('config-import'); } catch (e) {}
    btnImportConfig.disabled = false;
    if (r && r.ok) backupStatus.textContent = i18n.t('settings.import_ok');
    else if (r && r.canceled) backupStatus.textContent = '';
    else if (r && r.error === 'invalid') backupStatus.textContent = i18n.t('settings.import_invalid');
    else backupStatus.textContent = i18n.t('settings.backup_failed');
});

// After an import, re-pull the visible toggles so the UI matches the
// newly-applied settings without a restart. (Launch-only settings still take
// full effect next launch — the status line tells the user.)
ipcRenderer.on('config-imported', async () => {
    try {
        const as = (await ipcRenderer.invoke('settings-get', 'autostart')) === true;
        autoStartToggle.checked = as;
        ipcRenderer.send('set-autostart', as); // apply the imported autostart state now
        const au = await ipcRenderer.invoke('settings-get', 'auto_update');       autoUpdateToggle.checked  = au === undefined ? true : au === true;
        const un = await ipcRenderer.invoke('settings-get', 'show_update_notes');  updateNotesToggle.checked = un === undefined ? true : un === true;
        failoverToggle.checked = (await ipcRenderer.invoke('settings-get', 'dpi_failover')) === true;
        const tr = await ipcRenderer.invoke('settings-get', 'dpi_use_tr_master_list'); trMasterToggle.checked = tr === undefined ? true : tr === true;
    } catch (e) {}
    try { highlightActiveLang(); } catch (e) {}
});

// ==========================================
// --- PROXY BRIDGE ---
// ==========================================
// Surfaces Tor's SOCKS endpoint, an optional HTTP→SOCKS bridge, and a PAC file
// so other apps can route through Tor. All the real work is in main (proxy.js);
// this only drives the UI.
let proxyWired = false;

function pxCopy(text, statusEl) {
    try { clipboard.writeText(String(text || '')); if (statusEl) statusEl.textContent = i18n.t('proxy.copied'); } catch (e) {}
}

async function refreshProxy() {
    let s = null;
    try { s = await ipcRenderer.invoke('proxy-status'); } catch (e) {}
    if (!s) return;
    if ($('pxTor')) $('pxTor').textContent = s.torReady ? i18n.t('home.tor_ready') : i18n.t('home.tor_idle');
    if ($('pxTorSub')) $('pxTorSub').textContent = s.torReady ? i18n.t('proxy.tor_on', { p: s.socksPort }) : i18n.t('proxy.tor_off');
    if ($('btnProxyStartTor')) $('btnProxyStartTor').style.display = s.torReady ? 'none' : '';
    if ($('pxSocks')) $('pxSocks').textContent = `${s.socksHost}:${s.socksPort}`;
    if ($('pxHttp')) $('pxHttp').textContent = `${s.socksHost}:${s.httpPort}`;
    if ($('btnToggleHttp')) $('btnToggleHttp').textContent = i18n.t(s.httpRunning ? 'proxy.disable' : 'proxy.enable');
    if ($('pxHttpStatus')) $('pxHttpStatus').textContent = s.httpRunning ? i18n.t('proxy.http_on', { p: s.httpPort }) : '';
}

function openProxy() {
    refreshProxy();
    if (proxyWired) return;
    proxyWired = true;
    $('btnProxyStartTor').addEventListener('click', () => {
        ipcRenderer.send('start-tor');
        if ($('pxTorSub')) $('pxTorSub').textContent = 'Starting Tor…';
    });
    $('btnCopySocks').addEventListener('click', () => pxCopy($('pxSocks').textContent, $('pxHttpStatus')));
    $('btnCopyHttp').addEventListener('click', () => pxCopy($('pxHttp').textContent, $('pxHttpStatus')));
    $('btnToggleHttp').addEventListener('click', async () => {
        let s = null;
        try { s = await ipcRenderer.invoke('proxy-status'); } catch (e) {}
        try {
            if (s && s.httpRunning) await ipcRenderer.invoke('proxy-http-stop');
            else await ipcRenderer.invoke('proxy-http-start', 9080);
        } catch (e) {}
        refreshProxy();
    });
    $('btnGenPac').addEventListener('click', async () => {
        let r = null;
        try { r = await ipcRenderer.invoke('proxy-write-pac'); } catch (e) {}
        if (r && r.ok) { $('pxPac').textContent = r.url; $('pxPacStatus').textContent = i18n.t('proxy.pac_saved'); }
        else { $('pxPacStatus').textContent = i18n.t('proxy.pac_failed'); }
    });
    $('btnCopyPac').addEventListener('click', () => pxCopy($('pxPac').textContent, $('pxPacStatus')));
}

if ($('btnOpenProxy')) $('btnOpenProxy').addEventListener('click', () => showView('proxyView'));
// Keep the proxy view's Tor line live if Tor becomes ready while it is open.
ipcRenderer.on('tor-ready', () => { if (currentView === 'proxyView') refreshProxy(); });

// ==========================================
// --- TOR BRIDGES (pluggable transports) ---
// ==========================================
// UI over the bridge config in main (tor.js). The transport binaries live in
// tor-bin/ and are the user's to supply; availability is reflected here.
let bridgesWired = false;
let brTransport = 'obfs4';

function paintBridgeAvail(s) {
    if (!s || !$('brAvail')) return;
    const avail = brTransport === 'snowflake' ? s.snowflakeAvailable : s.obfs4Available;
    const f = brTransport === 'snowflake' ? 'snowflake-client.exe' : 'obfs4proxy.exe / lyrebird.exe';
    $('brAvail').textContent = avail ? i18n.t('bridges.avail_ok', { f }) : i18n.t('bridges.avail_missing', { f });
    $('brAvail').style.color = avail ? 'var(--ok-lit)' : 'var(--bad-lit)';
}
function paintTransportPick() {
    document.querySelectorAll('#brTransport button').forEach(b => b.classList.toggle('on', b.dataset.t === brTransport));
}
async function refreshBridges() {
    let s = null;
    try { s = await ipcRenderer.invoke('tor-bridge-config'); } catch (e) {}
    if (!s) return;
    if ($('brEnable')) $('brEnable').checked = s.enabled;
    brTransport = s.transport;
    paintTransportPick();
    if ($('brLines')) $('brLines').value = s.lines || '';
    paintBridgeAvail(s);
    if ($('brStatus')) $('brStatus').textContent = s.torRunning ? (s.torReady ? i18n.t('home.tor_ready') : 'Starting Tor…') : i18n.t('home.tor_idle');
}
async function saveBridges(restart) {
    const cfg = { enabled: $('brEnable').checked, transport: brTransport, lines: $('brLines').value };
    try { await ipcRenderer.invoke('tor-bridge-save', cfg); } catch (e) {}
    if (restart) {
        try { await ipcRenderer.invoke('tor-restart'); } catch (e) {}
        if ($('brSaveStatus')) $('brSaveStatus').textContent = i18n.t('bridges.restarting');
    } else if ($('brSaveStatus')) {
        $('brSaveStatus').textContent = i18n.t('bridges.saved');
    }
    refreshBridges();
}
function openBridges() {
    refreshBridges();
    if (bridgesWired) return;
    bridgesWired = true;
    document.querySelectorAll('#brTransport button').forEach(b => b.addEventListener('click', async () => {
        brTransport = b.dataset.t;
        paintTransportPick();
        try { paintBridgeAvail(await ipcRenderer.invoke('tor-bridge-config')); } catch (e) {}
    }));
    if ($('btnBridgeSave')) $('btnBridgeSave').addEventListener('click', () => saveBridges(false));
    if ($('btnBridgeRestart')) $('btnBridgeRestart').addEventListener('click', () => saveBridges(true));
}
if ($('btnOpenBridges')) $('btnOpenBridges').addEventListener('click', () => showView('bridgesView'));
ipcRenderer.on('tor-ready', () => { if (currentView === 'bridgesView') refreshBridges(); });

// ==========================================
// --- STATS PANEL ---
// ==========================================
// Reads the persisted engine stats (main: zapret/stats.js) and paints the
// tiles, sparkline, per-profile ranks and failover history. A 1s ticker keeps
// the live "uptime" tile moving while the panel is open and a session runs.
let lastStats = null;
let statsTicker = null;

function fmtDur(ms) {
    const s = Math.floor((ms || 0) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? i18n.t('home.uptime_hm', { h, m }) : i18n.t('home.uptime_m', { m });
}

function renderSpark(timeline) {
    const el = $('stSpark');
    if (!el) return;
    const pts = (timeline || []).slice(-60);
    el.replaceChildren();
    if (!pts.length) {
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        const e = document.createElement('span');
        e.className = 'tiny';
        e.textContent = i18n.t('stats.timeline_empty');
        el.appendChild(e);
        return;
    }
    el.style.alignItems = 'flex-end';
    el.style.justifyContent = '';
    pts.forEach(p => {
        const rate = p.total ? (p.ok / p.total) : 0;
        const bar = document.createElement('i');
        bar.style.height = Math.max(8, Math.round(rate * 100)) + '%';
        if (rate < 0.5) bar.classList.add('bad');
        else if (rate < 0.85) bar.classList.add('warn');
        bar.title = Math.round(rate * 100) + '%';
        el.appendChild(bar);
    });
}

function renderProfileRanks(profiles) {
    const el = $('stProfiles');
    if (!el) return;
    el.replaceChildren();
    if (!profiles || !profiles.length) {
        const e = document.createElement('div');
        e.className = 'rank-empty';
        e.textContent = i18n.t('stats.no_profiles');
        el.appendChild(e);
        return;
    }
    profiles.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'rank' + (i === 0 ? ' first' : '');
        const n = document.createElement('div'); n.className = 'n'; n.textContent = String(i + 1);
        const rb = document.createElement('div'); rb.className = 'rb';
        const rn = document.createElement('div'); rn.className = 'rn'; rn.textContent = profileLabel(p.id);
        const rm = document.createElement('div'); rm.className = 'rm';
        const sr = document.createElement('span');
        if (p.successRate === null) {
            sr.textContent = i18n.t('stats.no_data');
        } else {
            sr.textContent = i18n.t('stats.success_n', { n: p.successRate });
            sr.className = p.successRate >= 85 ? 'y' : (p.successRate < 50 ? 'n2' : '');
        }
        const rt = document.createElement('span'); rt.textContent = fmtDur(p.runtimeMs);
        const ss = document.createElement('span'); ss.textContent = i18n.t('stats.sessions_n', { n: p.sessions });
        rm.append(sr, rt, ss);
        rb.append(rn, rm);
        row.append(n, rb);
        el.appendChild(row);
    });
}

function renderFailovers(list) {
    const el = $('stFailoverList');
    if (!el) return;
    el.replaceChildren();
    if (!list || !list.length) {
        const e = document.createElement('div');
        e.className = 'rank-empty';
        e.textContent = i18n.t('stats.no_failovers');
        el.appendChild(e);
        return;
    }
    list.slice(0, 20).forEach(f => {
        const row = document.createElement('div');
        row.className = 'rank';
        const rb = document.createElement('div'); rb.className = 'rb';
        const rn = document.createElement('div'); rn.className = 'rn';
        rn.textContent = `${profileLabel(f.from) || '—'} → ${profileLabel(f.to) || '—'}`;
        const rm = document.createElement('div'); rm.className = 'rm';
        const t = document.createElement('span'); t.textContent = new Date(f.ts).toLocaleString();
        rm.append(t);
        rb.append(rn, rm);
        row.append(rb);
        el.appendChild(row);
    });
}

async function refreshStats() {
    let s = null;
    try { s = await ipcRenderer.invoke('get-engine-stats'); } catch (e) {}
    if (!s) return;
    lastStats = s;

    if (s.currentSession) {
        $('stUptime').textContent = fmtDur(Date.now() - s.currentSession.start);
        $('stUptimeSub').textContent = profileLabel(s.currentSession.profile);
    } else {
        $('stUptime').textContent = '—';
        $('stUptimeSub').textContent = i18n.t('stats.idle_short');
    }
    $('stRuntime').textContent = fmtDur(s.totals.runtimeMs);
    $('stSessions').textContent = i18n.t('stats.sessions_n', { n: s.totals.sessions });
    $('stSuccess').textContent = s.totals.successRate === null ? '—' : (s.totals.successRate + '%');
    $('stProbes').textContent = i18n.t('stats.probes_n', { ok: s.totals.ok, n: s.totals.ok + s.totals.fail });
    $('stFailovers').textContent = String(s.totals.failoverCount);

    renderSpark(s.timeline);
    renderProfileRanks(s.profiles);
    renderFailovers(s.failovers);

    // Live uptime ticker — only while the panel is open and a session is running.
    if (statsTicker) { clearInterval(statsTicker); statsTicker = null; }
    if (s.currentSession && currentView === 'statsView') {
        statsTicker = setInterval(() => {
            if (currentView !== 'statsView') { clearInterval(statsTicker); statsTicker = null; return; }
            if (lastStats && lastStats.currentSession) {
                $('stUptime').textContent = fmtDur(Date.now() - lastStats.currentSession.start);
            }
        }, 1000);
    }
}

if ($('btnResetStats')) $('btnResetStats').addEventListener('click', async () => {
    try { await ipcRenderer.invoke('reset-engine-stats'); } catch (e) {}
    refreshStats();
});

// ==========================================
// --- INTEGRITY ---
// ==========================================
const V_PHASE = {
    connecting: 'verify.phase_connecting', download: 'verify.phase_download', extract: 'verify.phase_extract',
    check: 'verify.phase_check', repair: 'verify.phase_repair', cleanup: 'verify.phase_cleanup',
    done: 'verify.phase_done', error: 'verify.phase_error'
};
const verifyTerm = $('verifyTerm'), btnStartVerify = $('btnStartVerify');

function vLog(msg, type) {
    clearEmpty(verifyTerm);
    const d = document.createElement('div');
    d.className = 'l' + (type ? ' ' + type : '');
    d.textContent = msg;
    verifyTerm.appendChild(d);
    verifyTerm.scrollTop = verifyTerm.scrollHeight;
}

function startVerify() {
    btnStartVerify.disabled = true;
    btnStartVerify.textContent = i18n.t('verify.btn_analyzing');
    meter($('vMeter'), 0, 30);
    $('vPct').textContent = '0%';
    $('vPhase').textContent = i18n.t(V_PHASE.connecting);
    $('vFile').textContent = '—';
    verifyTerm.replaceChildren();
    vLog('Initiating integrity verification…');
    ipcRenderer.send('start-verification');
}
btnStartVerify.addEventListener('click', startVerify);

ipcRenderer.on('verify-progress', (e, d) => {
    if (!d) return;
    meter($('vMeter'), (d.percent || 0) / 100, 30);
    $('vPct').textContent = `${d.percent}%`;
    $('vFile').textContent = d.msg || '';
    const k = V_PHASE[d.phase];
    if (k) $('vPhase').textContent = i18n.t(k);
});
ipcRenderer.on('verify-log', (e, m) => {
    let t = '';
    if (m.includes('[MISSING FILE]') || m.includes('[CORRUPT FILE]')) t = 'warn';
    if (m.includes('repaired') || m.includes('flawless') || m.includes('Completed') || m.includes('100%')) t = 'ok';
    vLog(m, t);
});
ipcRenderer.on('verify-error', (e, m) => {
    vLog(`ERROR: ${m}`, 'bad');
    btnStartVerify.disabled = false;
    btnStartVerify.textContent = i18n.t('common.retry');
    $('vPhase').textContent = i18n.t(V_PHASE.error);
    $('vMeter').classList.add('warn');
});
ipcRenderer.on('verify-done', (e, r) => {
    meter($('vMeter'), 1, 30);
    $('vMeter').classList.add('ok');
    $('vPct').textContent = '100%';
    $('vPhase').textContent = i18n.t(V_PHASE.done);
    btnStartVerify.disabled = false;
    btnStartVerify.textContent = i18n.t('verify.btn_start');
    if (r && r.repairedCount > 0) vLog(`${r.repairedCount} file(s) repaired.`, 'ok');
    else vLog('Integrity verified at 100%.', 'ok');
});

// ==========================================
// --- STARTUP ---
// ==========================================
(async () => {
    try {
        const st = await ipcRenderer.invoke('query-engine-status');
        if (st && st.zapret && st.zapret.running) {
            engineRunning = true; engineMode = st.zapret.mode;
            if (!startedAt) startedAt = Date.now();
        }
        if (st && st.tor && st.tor.ready) torReady = true;
    } catch (e) {}
    loadCustom();
    paintState();
    paintTor();
    await loadProfiles();
    loadUserProfiles();
    loadCustom();
    // Re-apply the saved selection now that user profiles are registered too
    // (loadProfiles ran before them and would have fallen back to bw_standard).
    try {
        const saved = await ipcRenderer.invoke('settings-get', 'last_profile');
        const target = engineMode || saved;
        if (target && (profileLabels[target] || target === 'custom')) profileSelect.value = target;
    } catch (e) {}
    if (engineMode && (profileLabels[engineMode] || engineMode === 'custom')) profileSelect.value = engineMode;
    paintProfileName();
    finishBoot();
    detectISP();
    refreshDns();
    maybeNotes();
})();
