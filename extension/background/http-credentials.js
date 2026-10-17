/** Host-only credential bridge. Values never enter observations, traces or page scripts. */
export async function readHttpCookies(chrome, payload) {
  const fail = () => { throw new Error('Invalid scoped HTTP credential request.'); };
  let url;
  try { url = new URL(payload?.url); } catch { fail(); }
  const names = payload?.names;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
    || !Array.isArray(names) || !names.length || names.length > 32 || new Set(names).size !== names.length
    || names.some(name => typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))) fail();
  const cookies = await chrome.cookies.getAll({ url: url.href });
  // Partitioned cookies need a declared top-level partition; never guess or merge stores.
  return { cookies: cookies.filter(cookie => names.includes(cookie.name) && !cookie.partitionKey)
    .map(cookie => ({ name: cookie.name, value: cookie.value })) };
}
