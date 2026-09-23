export function adapterPackageStatus(site) {
  if (!site.managed) return ''
  const sources = { builtin: '内置', user: '用户安装', development: '开发目录' }
  const source = Object.hasOwn(sources, site.managed.source) ? sources[site.managed.source] : '来源待选择'
  const version = site.managed.version ? ` · v${site.managed.version}` : ''
  const unavailable = !site.enabled && !site.managed.canEnable ? ' · 包不可用，请检查安装或来源' : ''
  return source + version + unavailable
}
