// The renderer owns its in-memory draft; only the main frame may resolve a leave request.
export function createExplorationCloseGuard(ipcMain, getWindow) {
  let dirty = false
  let pending = null
  let sequence = 0
  const trusted = event => event.sender === getWindow()?.webContents && event.senderFrame === event.sender.mainFrame
  ipcMain.on('website-exploration:dirty', (event, value) => {
    if (trusted(event)) dirty = value === true
  })
  ipcMain.on('website-exploration:leave-result', (event, id, allowed) => {
    if (!trusted(event) || !pending || pending.id !== id) return
    const finish = pending.resolve
    clearTimeout(pending.timer)
    pending = null
    if (allowed === true) dirty = false
    finish(allowed === true)
  })
  return {
    isDirty: () => dirty,
    request: () => {
      if (!dirty) return Promise.resolve(true)
      if (pending) return pending.promise
      const window = getWindow()
      if (!window || window.isDestroyed()) return Promise.resolve(false)
      const id = ++sequence
      let resolve
      const promise = new Promise(done => { resolve = done })
      const timer = setTimeout(() => { pending = null; resolve(false) }, 120000)
      pending = { id, promise, resolve, timer }
      window.show()
      window.focus()
      window.webContents.send('website-exploration:leave', id)
      return promise
    },
  }
}
