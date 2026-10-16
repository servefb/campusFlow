import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 本地开发把 /api/v1、/api/v2 转给后端（生产环境由网关承担同一职责）。
    // 后端路由不带版本前缀（如 /workspace/summary），所以转发时把前缀重写掉。
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v1/, ''),
      },
      '/api/v2': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v2/, ''),
      },
    },
  },
})
