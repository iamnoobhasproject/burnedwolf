// ==========================================
// --- BURNEDCORD DESKTOP INTEGRATION ---
// ==========================================
// BurnedCord is shipped inside the BurnedWolf app.asar but runs in its own
// BrowserWindow and owns a separate tray icon. Its media path remains WebRTC;
// this module only provides the desktop shell, the HTTPS API bridge and native
// screen-source enumeration.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, desktopCapturer, session, clipboard } = require('electron');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, CURRENT_VERSION } = require('./constants');

const API_ORIGIN = 'https://chat.whyscripts.com';
const BURNEDCORD_APP_URL = `${API_ORIGIN}/app/`;
let cordWindow = null;
let cordTray = null;
let explicitCordQuit = false;
const pendingDisplayCapture = new Map();
let pttWatcher = null;
let pttWatcherCode = '';
let pttWatcherVk = null;
let pttWatcherDesired = null;
let pttRestartTimer = null;

const PTT_VK = Object.freeze({
    Space: 0x20, Enter: 0x0D, NumpadEnter: 0x0D, Tab: 0x09, Backspace: 0x08, Escape: 0x1B, CapsLock: 0x14,
    ShiftLeft: 0xA0, ShiftRight: 0xA1, ControlLeft: 0xA2, ControlRight: 0xA3, AltLeft: 0xA4, AltRight: 0xA5,
    ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28, Insert: 0x2D, Delete: 0x2E,
    Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, PrintScreen: 0x2C, ScrollLock: 0x91, Pause: 0x13,
    Backquote: 0xC0, Minus: 0xBD, Equal: 0xBB, BracketLeft: 0xDB, BracketRight: 0xDD, Backslash: 0xDC,
    Semicolon: 0xBA, Quote: 0xDE, Comma: 0xBC, Period: 0xBE, Slash: 0xBF,
    Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63, Numpad4: 0x64, Numpad5: 0x65,
    Numpad6: 0x66, Numpad7: 0x67, Numpad8: 0x68, Numpad9: 0x69, NumpadMultiply: 0x6A, NumpadAdd: 0x6B,
    NumpadSubtract: 0x6D, NumpadDecimal: 0x6E, NumpadDivide: 0x6F, Mouse4: 0x05, Mouse5: 0x06,
});

function keyCodeToVirtualKey(code) {
    const value = String(code || '');
    const alpha = value.match(/^Key([A-Z])$/);
    if (alpha) return alpha[1].charCodeAt(0);
    const digit = value.match(/^Digit([0-9])$/);
    if (digit) return digit[1].charCodeAt(0);
    const fn = value.match(/^F([1-9]|1[0-9]|2[0-4])$/);
    if (fn) return 0x70 + Number(fn[1]) - 1;
    return PTT_VK[value] ?? null;
}

function emitPttState(pressed, code = pttWatcherCode) {
    try {
        if (cordWindow && !cordWindow.isDestroyed()) {
            cordWindow.webContents.send('burnedcord-ptt-state', { pressed: !!pressed, code: String(code || '') });
        }
    } catch {}
}

function stopPttWatcher({ clearDesired = false } = {}) {
    if (pttRestartTimer) clearTimeout(pttRestartTimer);
    pttRestartTimer = null;
    const watcher = pttWatcher;
    pttWatcher = null;
    try { watcher?.stdout?.removeAllListeners(); } catch {}
    try { watcher?.stderr?.removeAllListeners(); } catch {}
    try { watcher?.kill(); } catch {}
    emitPttState(false);
    pttWatcherCode = '';
    pttWatcherVk = null;
    if (clearDesired) pttWatcherDesired = null;
}

function launchPttWatcher(code, vk) {
    if (process.platform !== 'win32') return { ok: false, supported: false, reason: 'WINDOWS_ONLY' };
    const script = [
        "$ErrorActionPreference = 'Stop'",
        'Add-Type -TypeDefinition @"',
        'using System;',
        'using System.Runtime.InteropServices;',
        'public static class BurnedCordKeyState {',
        '  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);',
        '}',
        '"@',
        `$vk = ${vk}`,
        '$last = $false',
        'while ($true) {',
        '  $down = (([BurnedCordKeyState]::GetAsyncKeyState($vk) -band 0x8000) -ne 0)',
        '  if ($down -ne $last) { if ($down) { [Console]::Out.WriteLine("DOWN") } else { [Console]::Out.WriteLine("UP") }; [Console]::Out.Flush(); $last = $down }',
        '  [System.Threading.Thread]::Sleep(8)',
        '}',
    ].join('\n');
    let child;
    try {
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (err) {
        return { ok: false, supported: true, reason: err?.message || 'PTT_WATCHER_START_FAILED' };
    }
    pttWatcher = child;
    pttWatcherCode = code;
    pttWatcherVk = vk;
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        pending += String(chunk || '');
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) {
            const value = line.trim();
            if (value === 'DOWN') emitPttState(true, code);
            else if (value === 'UP') emitPttState(false, code);
        }
    });
    child.on('exit', () => {
        if (pttWatcher !== child) return;
        pttWatcher = null;
        emitPttState(false, code);
        if (pttWatcherDesired?.enabled && pttWatcherDesired.code === code && cordWindow && !cordWindow.isDestroyed()) {
            pttRestartTimer = setTimeout(() => {
                pttRestartTimer = null;
                const wanted = pttWatcherDesired;
                if (wanted?.enabled) configureGlobalPtt(wanted);
            }, 1200);
        }
    });
    child.on('error', () => emitPttState(false, code));
    return { ok: true, supported: true, code, vk };
}

function configureGlobalPtt(options = {}) {
    const enabled = options?.enabled === true;
    const code = String(options?.code || '');
    pttWatcherDesired = { enabled, code };
    if (!enabled) { stopPttWatcher(); return { ok: true, supported: process.platform === 'win32', active: false }; }
    const vk = keyCodeToVirtualKey(code);
    if (process.platform !== 'win32') return { ok: false, supported: false, active: false, reason: 'WINDOWS_ONLY' };
    if (vk == null) { stopPttWatcher(); return { ok: false, supported: true, active: false, reason: 'UNSUPPORTED_KEY' }; }
    if (pttWatcher && pttWatcherCode === code && pttWatcherVk === vk) return { ok: true, supported: true, active: true, code, vk };
    stopPttWatcher();
    const result = launchPttWatcher(code, vk);
    return { ...result, active: !!result.ok };
}

function isSafeApiPath(value) {
    const p = String(value || '');
    return p.startsWith('/api/') && !p.includes('\\') && !p.startsWith('//');
}

function requestApi(pathname, options = {}) {
    return new Promise((resolve) => {
        if (!isSafeApiPath(pathname)) {
            resolve({ ok: false, status: 400, data: { error: 'INVALID_API_PATH' } });
            return;
        }
        let url;
        try { url = new URL(pathname, API_ORIGIN); }
        catch { resolve({ ok: false, status: 400, data: { error: 'INVALID_API_PATH' } }); return; }
        if (url.origin !== API_ORIGIN) {
            resolve({ ok: false, status: 400, data: { error: 'INVALID_API_ORIGIN' } });
            return;
        }
        const method = String(options.method || 'GET').toUpperCase();
        const rawHeaders = options.headers && typeof options.headers === 'object' ? options.headers : {};
        const headers = {
            'Accept': 'application/json',
            'User-Agent': `BurnedCord/${CURRENT_VERSION} BurnedWolf/${CURRENT_VERSION}`,
        };
        for (const [k, v] of Object.entries(rawHeaders)) {
            const key = String(k).toLowerCase();
            if (['authorization', 'x-whyscripts-session', 'content-type'].includes(key) && v != null) headers[k] = String(v);
        }
        let body = options.body == null ? null : String(options.body);
        if (body && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
        if (body) headers['Content-Length'] = Buffer.byteLength(body);

        const req = https.request(url, { method, headers, timeout: 20000 }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let data = null;
                if (text) {
                    try { data = JSON.parse(text); }
                    catch { data = { raw: text }; }
                }
                resolve({ ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300, status: res.statusCode || 500, data });
            });
        });
        req.on('timeout', () => req.destroy(new Error('REQUEST_TIMEOUT')));
        req.on('error', (err) => resolve({ ok: false, status: 0, data: { error: 'CONNECTION_ERROR', detail: err.message } }));
        if (body) req.write(body);
        req.end();
    });
}

function buildTrayMenu() {
    return Menu.buildFromTemplate([
        { label: 'Open BurnedCord', click: () => openBurnedCord() },
        { label: 'Hide BurnedCord', click: () => { if (cordWindow && !cordWindow.isDestroyed()) cordWindow.hide(); } },
        { type: 'separator' },
        { label: 'Open BurnedWolf', click: () => {
            try {
                const main = require('./windows').getMainWindow();
                if (main && !main.isDestroyed()) { main.show(); main.focus(); }
            } catch {}
        } },
        { type: 'separator' },
        { label: 'Quit BurnedCord', click: () => destroyBurnedCord() },
    ]);
}

function ensureTray() {
    if (cordTray && !cordTray.isDestroyed()) return cordTray;
    cordTray = new Tray(path.join(ROOT, 'burnedcord', 'icon.png'));
    cordTray.setToolTip('BurnedCord · whyscripts.com');
    cordTray.setContextMenu(buildTrayMenu());
    cordTray.on('click', () => {
        if (!cordWindow || cordWindow.isDestroyed()) return openBurnedCord();
        if (cordWindow.isVisible()) cordWindow.hide();
        else { cordWindow.show(); cordWindow.focus(); }
    });
    return cordTray;
}

function isBurnedCordContents(wc) {
    if (!cordWindow || cordWindow.isDestroyed()) return false;
    // Electron can invoke permission checks with a null WebContents. In that case
    // the requestingOrigin/details check below becomes the trust boundary.
    return !wc || wc.id === cordWindow.webContents.id;
}

function isBurnedCordOrigin(origin) {
    const value = String(origin || '');
    if (value === '' || value === 'file://' || value === 'file:///' || value.startsWith('file:')) return true;
    try {
        const u = new URL(value);
        return u.origin === API_ORIGIN;
    } catch {
        return false;
    }
}

function configureMediaPermissions(partition) {
    const s = session.fromPartition(partition);
    const allowed = new Set(['media', 'microphone', 'camera', 'audioCapture', 'videoCapture', 'display-capture']);

    s.setPermissionRequestHandler((wc, permission, callback, details = {}) => {
        const origin = details.securityOrigin || details.requestingUrl || wc?.getURL?.() || '';
        callback(isBurnedCordContents(wc) && isBurnedCordOrigin(origin) && allowed.has(permission));
    });

    s.setPermissionCheckHandler((wc, permission, requestingOrigin, details = {}) => {
        const origin = requestingOrigin || details.securityOrigin || details.requestingUrl || wc?.getURL?.() || '';
        return isBurnedCordContents(wc) && isBurnedCordOrigin(origin) && allowed.has(permission);
    });

    // Screen sharing uses Electron's supported getDisplayMedia bridge instead of
    // Chromium's legacy chromeMediaSource renderer constraints. This also lets
    // Windows attach system loopback audio to the same share.
    s.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
            const frameWc = request.frame?.webContents || request.frame?.top?.webContents || null;
            if (!isBurnedCordContents(frameWc) || !isBurnedCordOrigin(request.securityOrigin)) {
                callback({});
                return;
            }
            const wcId = cordWindow?.webContents?.id;
            const pending = wcId ? pendingDisplayCapture.get(wcId) : null;
            if (!pending || pending.expiresAt < Date.now()) {
                if (wcId) pendingDisplayCapture.delete(wcId);
                callback({});
                return;
            }
            pendingDisplayCapture.delete(wcId);
            const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } });
            const source = sources.find((item) => item.id === pending.sourceId);
            if (!source) { callback({}); return; }
            const streams = { video: source };
            if (pending.includeAudio && process.platform === 'win32' && request.audioRequested) streams.audio = 'loopback';
            callback(streams);
        } catch {
            callback({});
        }
    });
}

function createBurnedCordWindow() {
    if (cordWindow && !cordWindow.isDestroyed()) return cordWindow;
    const partition = 'persist:burnedcord';
    configureMediaPermissions(partition);
    explicitCordQuit = false;
    cordWindow = new BrowserWindow({
        width: 1180,
        height: 780,
        minWidth: 900,
        minHeight: 620,
        backgroundColor: '#000000',
        frame: false,
        show: false,
        resizable: true,
        icon: path.join(ROOT, 'burnedcord', 'icon.png'),
        title: 'BurnedCord · whyscripts.com',
        webPreferences: {
            preload: path.join(ROOT, 'burnedcord', 'preload.js'),
            partition,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            backgroundThrottling: false,
        },
    });
    // BurnedCord originally worked as an HTTPS web app. Running the same UI from
    // file:// changed Chromium's media/clipboard/security behaviour. Keep the
    // desktop shell native, but run the renderer from the canonical HTTPS origin.
    // Chat requires the service anyway, so this also keeps browser and desktop
    // media behaviour identical.
    cordWindow.loadURL(`${BURNEDCORD_APP_URL}?desktop=1&v=${encodeURIComponent(CURRENT_VERSION)}`);

    cordWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const u = new URL(url);
            if (u.origin === API_ORIGIN) return { action: 'allow' };
            if (['https:', 'http:'].includes(u.protocol)) shell.openExternal(u.toString()).catch(() => {});
        } catch {}
        return { action: 'deny' };
    });
    cordWindow.webContents.on('will-navigate', (event, url) => {
        try {
            const u = new URL(url);
            if (u.origin === API_ORIGIN) return;
            event.preventDefault();
            if (['https:', 'http:'].includes(u.protocol)) shell.openExternal(u.toString()).catch(() => {});
        } catch { event.preventDefault(); }
    });
    cordWindow.once('ready-to-show', () => { try { cordWindow.webContents.setAudioMuted(false); } catch {} cordWindow.show(); cordWindow.focus(); });
    cordWindow.on('close', (event) => {
        if (!explicitCordQuit) {
            event.preventDefault();
            cordWindow.hide();
        }
    });
    cordWindow.on('closed', () => { try { pendingDisplayCapture.delete(cordWindow?.webContents?.id); } catch {} stopPttWatcher(); cordWindow = null; explicitCordQuit = false; });
    ensureTray();
    return cordWindow;
}

function openBurnedCord() {
    const w = createBurnedCordWindow();
    if (!w.isDestroyed()) { w.show(); if (w.isMinimized()) w.restore(); w.focus(); }
    return w;
}

function destroyBurnedCord() {
    explicitCordQuit = true;
    stopPttWatcher({ clearDesired: true });
    try { if (cordWindow && !cordWindow.isDestroyed()) cordWindow.destroy(); } catch {}
    cordWindow = null;
    try { if (cordTray && !cordTray.isDestroyed()) cordTray.destroy(); } catch {}
    cordTray = null;
    explicitCordQuit = false;
}

app.on('before-quit', () => {
    explicitCordQuit = true;
    stopPttWatcher({ clearDesired: true });
    try { if (cordWindow && !cordWindow.isDestroyed()) cordWindow.destroy(); } catch {}
    cordWindow = null;
    try { if (cordTray && !cordTray.isDestroyed()) cordTray.destroy(); } catch {}
    cordTray = null;
});

ipcMain.on('open-burnedcord', () => openBurnedCord());
ipcMain.on('burnedcord-window-action', (event, action) => {
    if (!cordWindow || cordWindow.isDestroyed()) return;
    if (action === 'minimize' || action === 'hide' || action === 'close') cordWindow.hide();
    else if (action === 'maximize') {
        if (cordWindow.isMaximized()) cordWindow.unmaximize(); else cordWindow.maximize();
    }
});
ipcMain.handle('burnedcord-api-request', (event, pathname, options) => requestApi(pathname, options));
ipcMain.handle('burnedcord-prepare-screen-capture', async (event, options = {}) => {
    if (!cordWindow || cordWindow.isDestroyed() || event.sender.id !== cordWindow.webContents.id) return false;
    const sourceId = String(options?.sourceId || '');
    if (!/^screen:|^window:/.test(sourceId)) return false;
    pendingDisplayCapture.set(event.sender.id, {
        sourceId,
        includeAudio: options?.includeAudio !== false,
        expiresAt: Date.now() + 15000,
    });
    return true;
});

ipcMain.handle('burnedcord-media-capabilities', (event) => ({
    systemAudio: process.platform === 'win32',
    globalPtt: process.platform === 'win32',
    platform: process.platform,
}));

ipcMain.handle('burnedcord-set-global-ptt', (event, options = {}) => {
    if (!cordWindow || cordWindow.isDestroyed() || event.sender.id !== cordWindow.webContents.id) return { ok: false, supported: false, active: false, reason: 'INVALID_WINDOW' };
    return configureGlobalPtt(options);
});

ipcMain.handle('burnedcord-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
    });
    return sources.map((s) => ({
        id: s.id,
        name: s.name,
        displayId: s.display_id || '',
        thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
        appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
    }));
});

ipcMain.handle('burnedcord-copy-text', async (event, value) => {
    try {
        clipboard.writeText(String(value ?? ''));
        return true;
    } catch {
        return false;
    }
});
ipcMain.handle('burnedcord-open-external', async (event, value) => {
    try {
        const u = new URL(String(value || ''));
        if (!['https:', 'http:'].includes(u.protocol)) return false;
        await shell.openExternal(u.toString());
        return true;
    } catch { return false; }
});
ipcMain.handle('burnedcord-version', () => CURRENT_VERSION);

module.exports = { openBurnedCord, createBurnedCordWindow, destroyBurnedCord, getWindow: () => cordWindow };
