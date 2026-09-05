export const getToken = () => localStorage.getItem('kokoon-token');
export const setToken = (t) =>
  t ? localStorage.setItem('kokoon-token', t) : localStorage.removeItem('kokoon-token');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new Error(json.error || `request failed (${res.status})`);
  }
  return json;
}
