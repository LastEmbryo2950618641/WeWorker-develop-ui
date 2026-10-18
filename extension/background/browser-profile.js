// One random identity per Chrome storage context, persisted across worker reloads.
// Deliberately not derived from accounts, installation paths or browser fingerprints.
let identityPromise;
export function browserContextId(storage, uuid = () => crypto.randomUUID()) {
  return identityPromise ||= (async () => {
    const key = 'webcliBrowserContextId';
    const stored = (await storage.get(key))[key];
    if (stored !== undefined) {
      if (typeof stored !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(stored)) throw new Error('Invalid browser context identity; repair webcliBrowserContextId before connecting.');
      return stored;
    }
    const id = uuid(); await storage.set({ [key]: id }); return id;
  })().catch(error => { identityPromise = null; throw error; });
}
