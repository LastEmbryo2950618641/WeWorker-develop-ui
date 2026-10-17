import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Read .build-defines.json for provider injection; fall back to defaults for dev mode
let buildDefines
try {
  buildDefines = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../build/.build-defines.json'), 'utf-8'))
} catch {
  console.warn('[vite] .build-defines.json not found, using built-in defaults (dev mode)')
  buildDefines = {
    providers: [
      {"id":"builtin","name":"内置模型","models":["ark-code-latest"],"defaultModel":"ark-code-latest","weworker":{"protocol":"anthropic_messages","baseUrl":"https://ark.cn-beijing.volces.com/api/plan"},"webwright":{"protocol":"openai_chat_completions","modelClass":"zhipu","baseUrl":"https://ark.cn-beijing.volces.com/api/plan/v3","structuredOutput":"openai_json_object"}},
      {"id":"builtin_dev","name":"内置模型（开发）","models":["deepseek-v4-flash"],"defaultModel":"deepseek-v4-flash","weworker":{"protocol":"anthropic_messages","baseUrl":""},"webwright":{"protocol":"anthropic_messages","modelClass":"anthropic","baseUrl":"","structuredOutput":"anthropic_json_schema"}},
      { id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'], defaultModel: 'claude-sonnet-4-6', weworker: { protocol: 'anthropic_messages', baseUrl: 'https://api.anthropic.com' }, webwright: { protocol: 'anthropic_messages', modelClass: 'anthropic', baseUrl: 'https://api.anthropic.com', structuredOutput: 'anthropic_json_schema' } },
      { id: 'glm', name: '智谱 coding plan', models: ['glm-5.2', 'glm-4.7'], defaultModel: 'glm-5.2', weworker: { protocol: 'anthropic_messages', baseUrl: 'https://open.bigmodel.cn/api/anthropic' }, webwright: { protocol: 'openai_chat_completions', modelClass: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', structuredOutput: 'openai_json_object' } },
      { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-v4-flash', 'deepseek-v4-pro'], defaultModel: 'deepseek-v4-flash', weworker: { protocol: 'anthropic_messages', baseUrl: 'https://api.deepseek.com/anthropic' }, webwright: { protocol: 'openai_chat_completions', modelClass: 'openai_chat', baseUrl: 'https://api.deepseek.com', structuredOutput: 'openai_json_object' } },
      { id: 'custom', name: '自定义', models: [], defaultModel: '', weworker: { protocol: 'anthropic_messages', baseUrl: '' }, webwright: { protocol: 'openai_chat_completions', modelClass: 'openai_chat', baseUrl: '', structuredOutput: 'openai_json_object' } },
    ],
    defaultProvider: 'anthropic',
  }
}

// Read git commit hash for dev mode
let devCommitHash = 'dev'
try {
  const { execSync } = await import('child_process')
  devCommitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
} catch {}

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
  build: { outDir: 'dist' },
  define: {
    '__BUILD_PROVIDERS__': JSON.stringify(buildDefines.providers),
    '__BUILD_DEFAULT_PROVIDER__': JSON.stringify(buildDefines.defaultProvider),
    '__BUILD_COMMIT_HASH__': JSON.stringify(buildDefines.commitHash || devCommitHash),
  },
})
