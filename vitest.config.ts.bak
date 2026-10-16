import { defineConfig } from 'vitest/config'

// 09-19 原版配置精确恢复（无 dedupe、无 external）
export default defineConfig({
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'react-dom/client', 'scheduler'],
        },
      },
    },
  },
})
