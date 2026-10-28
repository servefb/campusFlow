import { useEffect, useState } from 'react'
import { AlertTriangle, CloudUpload, FileText, RefreshCw, Settings2 } from 'lucide-react'
import { PageTitle, StatusBadge } from '../components/ui'
import { apiErrorMessage } from '../services/http'
import { getKnowledgeCategories } from '../services/knowledge'
import { getKnowledgeHealthMetrics } from '../services/metrics'
import type { KnowledgeCategory } from '../types/api'

export function AdminKnowledgePage() {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { Promise.all([getKnowledgeCategories(), getKnowledgeHealthMetrics()]).then(([categoryResponse, healthResponse]) => { setCategories(categoryResponse.data.data.items); setHealth(healthResponse.data.data as unknown as Record<string, unknown>) }).catch((requestError) => setError(apiErrorMessage(requestError, '知识库治理数据加载失败'))) }, [])
  return <section className="page wide-page"><PageTitle eyebrow="KNOWLEDGE GOVERNANCE" title="知识库治理" description="文档处理、索引健康和冲突信息来自管理员接口。" actions={<button className="primary-button"><CloudUpload size={16} />上传校规资料</button>} />{error && <div className="form-error">{error}</div>}<div className="admin-stats"><div><FileText size={20} /><span><small>分类数量</small><strong>{categories.length || '—'}</strong></span></div><div><RefreshCw size={20} /><span><small>文档统计</small><strong>{health ? '已返回' : '—'}</strong></span></div><div><Settings2 size={20} /><span><small>索引健康</small><strong>{health ? '已连接' : '—'}</strong></span></div></div><div className="admin-layout"><section className="admin-doc-list">{categories.length ? categories.map((category) => <article className="admin-doc-card" key={category.id}><div className="admin-doc-main"><FileText size={22} /><div><h2>{category.name}</h2><p>{category.document_count} 部文档，由知识库接口返回。</p></div></div><StatusBadge tone="neutral">接口数据</StatusBadge></article>) : <div className="empty-results"><AlertTriangle size={30} /><p>暂无分类数据</p></div>}</section><aside className="review-panel"><h2>治理状态</h2><pre>{health ? JSON.stringify(health, null, 2) : '暂无后端返回的健康指标'}</pre></aside></div></section>
}
