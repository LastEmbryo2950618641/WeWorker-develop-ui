/** Host-only credential bridge. Values never enter observations, traces or page scripts. */
export async function readHttpCookies(chrome, payload) {
  const fail = () => { throw new Error('Invalid scoped HTTP credential request.'); };
  let url;
  try { url = new URL(payload?.url); } catch { fail(); }
  const names = payload?.names;
  const version = payload?.version ?? 1;
  if (![1, 2].includes(version) || Object.keys(payload).some(key => !['version', 'url', 'names', ...(version === 2 ? ['storeId', 'partitionKey'] : [])].includes(key))) fail();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
    || !Array.isArray(names) || !names.length || names.length > 32 || new Set(names).size !== names.length
    || names.some(name => typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))) fail();
  const { storeId, partitionKey } = payload;
  if (storeId !== undefined && (typeof storeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(storeId))) fail();
  if (partitionKey !== undefined) {
    let site;
    try { site = new URL(partitionKey?.topLevelSite); } catch { fail(); }
    if (!partitionKey || typeof partitionKey !== 'object' || Array.isArray(partitionKey)
      || Object.keys(partitionKey).some(key => !['topLevelSite', 'hasCrossSiteAncestor'].includes(key))
      || !['http:', 'https:'].includes(site.protocol) || site.origin !== partitionKey.topLevelSite || site.username || site.password
      || typeof partitionKey.hasCrossSiteAncestor !== 'boolean') fail();
  }
  const cookies = await chrome.cookies.getAll({ url: url.href,
    ...(storeId !== undefined ? { storeId } : {}), ...(partitionKey ? { partitionKey } : {}) });
  // Check returned identities too: unsupported browsers must never silently fall
  // back to an unpartitioned cookie or a different store/ancestor partition.
  return { cookies: cookies.filter(cookie => names.includes(cookie.name)
      && (storeId === undefined || cookie.storeId === storeId)
      && (partitionKey ? cookie.partitionKey?.topLevelSite === partitionKey.topLevelSite
        && cookie.partitionKey.hasCrossSiteAncestor === partitionKey.hasCrossSiteAncestor : !cookie.partitionKey))
    .map(cookie => ({ name: cookie.name, value: cookie.value })) };
}
