import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  // .workbuddy 是本地预览工装/记忆目录（Node 环境脚本），不参与应用代码检查，
  // 否则 272 条 no-undef 噪声会把 `pnpm lint` 变成不可用的门禁。
  { ignores: ['dist', 'node_modules', '.workbuddy'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
)
