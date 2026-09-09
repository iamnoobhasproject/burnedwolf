// BurnedWolf distribution endpoints.
// Keep public product/update URLs in one place so renderer, updater, AI and
// integrity repair cannot silently drift onto different release channels.
const WEBSITE_URL = 'https://burnedwolf.whyscripts.com';
const SOURCE_URL = 'https://github.com/iamnoobhasproject/burnedwolf';
const UPDATE_REPO = 'iamnoobhasproject/app-updates-whyscripts';
const UPDATE_MANIFEST_URL = `https://raw.githubusercontent.com/${UPDATE_REPO}/main/version.json`;
const CHANGELOG_URL = `https://raw.githubusercontent.com/${UPDATE_REPO}/main/logs.txt`;
const REPAIR_BUNDLE_URL = `https://github.com/${UPDATE_REPO}/releases/latest/download/net.zip`;

function parseVersion(value) {
  const m = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return m ? m.slice(1).map(Number) : null;
}

function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return String(candidate || '') !== String(current || '');
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

module.exports = {
  WEBSITE_URL, SOURCE_URL, UPDATE_REPO, UPDATE_MANIFEST_URL, CHANGELOG_URL,
  REPAIR_BUNDLE_URL, parseVersion, isNewerVersion
};
