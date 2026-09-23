import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let commitHash = ''
if (process.env.RELEASE_BUILD) {
  try {
    commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {}
}

export default defineConfig({
  plugins: [react()],
  define: {
    '__RELEASE_COMMIT__': JSON.stringify(commitHash),
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      // 本地开发：/api/stats 反代到 metrics-server，注入 Bearer token。
      // 浏览器同域请求 localhost:xxxx/api/stats（无 CORS），Vite 转发并加 token。
      // 生产环境走 Nginx 反代，不经过此处。
      // endpoint 和 token 只从本地环境变量读取，不进入源码或前端 bundle。
      '/api/stats': {
        target: process.env.METRICS_TARGET || 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (p) => p.replace('/api/stats', '/v1/stats'),
        headers: {
          Authorization: `Bearer ${process.env.METRICS_TOKEN || ''}`,
        },
      },
      '/api/visits': {
        target: process.env.METRICS_TARGET || 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (p) => p.replace('/api/visits', '/v1/visits'),
        headers: {
          Authorization: `Bearer ${process.env.METRICS_TOKEN || ''}`,
        },
      },
    },
  },
})
