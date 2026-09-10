const AUTH_KEY = 'burnedcord.sessionToken.v1';

export function getAuthToken() {
  try { return localStorage.getItem(AUTH_KEY) || ''; } catch { return ''; }
}
export function setAuthToken(token) {
  try { token ? localStorage.setItem(AUTH_KEY, token) : localStorage.removeItem(AUTH_KEY); } catch {}
}

export async function rawRequest(path, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}`, 'X-WhyScripts-Session': token } : {}),
    ...(options.headers || {})
  };
  const body = options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body;
  // The desktop renderer now runs from the same HTTPS origin as the web app.
  // Use the browser's native fetch path there; keep the old IPC bridge only as
  // a fallback for legacy file:// builds. This restores the exact networking
  // environment in which the web version's realtime/media flow worked.
  if (location.protocol === 'file:' && window.burnedCord?.apiRequest) {
    return await window.burnedCord.apiRequest(path, { ...options, headers, body });
  }
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', headers, ...options, body });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export async function api(path, options = {}) {
  const result = await rawRequest(path, options);
  const data = result?.data;
  if (!result?.ok) {
    if (result?.status === 401 && ['AUTH_REQUIRED', 'INVALID_SESSION'].includes(data?.error)) setAuthToken('');
    const err = new Error(data?.error || (result?.status ? `HTTP_${result.status}` : 'CONNECTION_ERROR'));
    err.code = data?.error || 'CONNECTION_ERROR';
    err.status = result?.status || 0;
    throw err;
  }
  if (data?.sessionToken) setAuthToken(String(data.sessionToken));
  return data;
}
