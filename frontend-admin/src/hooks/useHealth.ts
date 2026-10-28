import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../services/settings'
import { useDataModeStore } from '../stores/dataMode'

/**
 * 顶栏健康灯。文档第 15 章的 `GET /health/ready` 覆盖数据库、对象存储、模型、向量索引四件套。
 * AI 服务没起来时 `/api/v2/*` 返回 502，这里统一降级成「服务不可用」而不是抛错打断渲染。
 */
export function useHealth() {
  const mode = useDataModeStore((state) => state.mode)
  const query = useQuery({
    queryKey: ['health', mode],
    queryFn: async () => (await getHealth()).data,
    refetchInterval: 60_000,
    retry: 0,
  })

  if (query.isError) return { status: 'offline' as const, detail: '健康检查请求失败，后端可能未启动' }
  const status = (query.data?.status ?? 'healthy') as 'healthy' | 'degraded' | 'offline'
  const components = query.data?.components ?? {}
  const degraded = Object.values(components).some((value) => value !== 'up')
  return {
    status: query.data ? (degraded ? 'degraded' : status) : status,
    detail: degraded ? '部分依赖未就绪，见 /health/ready' : '数据库、对象存储、模型、向量索引均就绪',
  }
}
