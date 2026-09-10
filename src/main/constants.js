// App-wide constants shared by every main-process module.
const path = require('path');

// Project root — the directory that holds package.json, icon.png, the window
// HTML files and the binary folders (zapret-bin/, tor-bin/, dnsproxy-bin/).
// Computed from this file's location so it resolves identically when running
// from source (npm start) and from the packaged asar.
const ROOT = path.join(__dirname, '..', '..');

const OFFICIAL_APP_NAME = "BurnedWolf";
// Must match the "version" field in the update manifest that ships alongside the
// published app.asar — the updater installs only a strictly newer semantic version.
const CURRENT_VERSION = "4.6.0";

// Default update manifest. The updater swaps this for the real archive URL
// once `check-update` has parsed version.json (see updater.js).
const { UPDATE_MANIFEST_URL } = require('./distribution');

module.exports = { ROOT, OFFICIAL_APP_NAME, CURRENT_VERSION, UPDATE_MANIFEST_URL };
