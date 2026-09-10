// Sends an IPC message to every live renderer. This is the main process'
// only fan-out mechanism: engines broadcast state changes and any window
// that cares (DPI panel, spotlight, titlebar) picks them up.
const { BrowserWindow } = require('electron');

// Optional observers can subscribe to the same renderer event stream.
const taps = new Set();

function broadcastToAll(channel, ...args) {
    for (const tap of taps) {
        try { tap(channel, args); } catch (e) {}
    }
    BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) {
            try { w.webContents.send(channel, ...args); } catch (e) {}
        }
    });
}

function tapBroadcast(fn) {
    taps.add(fn);
    return () => taps.delete(fn);
}

module.exports = { broadcastToAll, tapBroadcast };
