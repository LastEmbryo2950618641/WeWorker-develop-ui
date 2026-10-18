const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const esbuild = require('esbuild')

for (const entry of ['webcli-dist', 'bridge-dist']) {
  test(`desktop ${entry} bundle loads the shared HTTP assertions from prepared resources`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-http-preview-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const desktop = path.join(root, 'weworker')
    const output = path.join(desktop, 'build', entry, 'preview.cjs')
    const extension = path.join(desktop, 'build/extension-dist/background')
    fs.mkdirSync(extension, { recursive: true })
    fs.mkdirSync(path.join(path.dirname(output), 'extension/adapters'), { recursive: true })
    fs.writeFileSync(path.join(desktop, 'build-profile.json'), '{}')
    fs.copyFileSync(path.resolve(__dirname, '../../../extension/background/strict-output-contract.js'), path.join(extension, 'strict-output-contract.js'))
    esbuild.buildSync({
      entryPoints: [path.resolve(__dirname, '../../../webcli/http-preview.js')],
      bundle: true, platform: 'node', format: 'cjs', outfile: output,
      define: { 'import.meta.url': '__importMetaUrl', 'import.meta.dirname': '__dirname' },
      banner: { js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
    })
    fs.appendFileSync(output, `\nmodule.exports.strictVerifier().then(verify => {
      const assert = require('node:assert/strict');
      const fixture = {version:1, equals:{'items.0.id':'example-item'}};
      assert.deepEqual(verify({items:[{id:'example-item'}]},fixture), []);
      assert.equal(verify({items:[{id:'different-item'}]},fixture)[0].code,'OUTPUT_VALUE_MISMATCH');
      console.log('verified');
    }).catch(error=>{console.error(error);process.exitCode=1});\n`)
    const env = { ...process.env }
    delete env.WEWORKER_RESOURCES_PATH
    assert.equal(execFileSync(process.execPath, [output], { env, encoding: 'utf8' }).trim(), 'verified')
  })
}
