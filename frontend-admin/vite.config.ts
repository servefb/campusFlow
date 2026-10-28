import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 固定 5180：学生端 campusflow 占用 5173/5174，固定端口避免"跑错页面"
    port: 5180,
    strictPort: true,
    proxy: {
      // 与接口文档 5.1 的服务划分一致。
      //
      // ⚠️ 两个前缀的剥法**不一样**，别照着对方改：
      //   /api/v1 → Java（Spring Boot 的 context-path 本身就配了 /api/v1），所以原样转发；
      //   /api/v2 → Python（FastAPI 路由不带版本前缀，如 /knowledge/ingest），必须 rewrite 掉。
      // 生产环境由 nginx 承担同一职责（location /api/v2/ → 127.0.0.1:8000/），
      // 这里漏了 rewrite 的表现是**只在本地开发复现的 404**：直连 5180 时请求会打到
      // http://127.0.0.1:8000/api/v2/knowledge/ingest。学生端 campusflow 的 dev proxy
      // 是带 rewrite 的，管理端此前没有 /api/v2 调用方所以没暴露。
      '/api/v1': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/api/v2': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v2/, ''),
      },
    },
  },
})
