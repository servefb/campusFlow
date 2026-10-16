import { useEffect, useState } from 'react'
import { BarChart3, CircleAlert, RefreshCw } from 'lucide-react'
import { PageTitle, StatusBadge } from '../components/ui'
import { apiErrorMessage } from '../services/http'
import { getAgentMetrics, getHotQuestions, getKnowledgeHealthMetrics, getOverviewMetrics, getReviews, getTrendMetrics } from '../services/metrics'

export function DashboardPage() {
  const [range, setRange] = useState('7d')
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>([])
  const [hotQuestions, setHotQuestions] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { let cancelled = false; setLoading(true); Promise.all([getOverviewMetrics(range), getTrendMetrics(range === '7d' ? '30d' : range), getAgentMetrics(range), getKnowledgeHealthMetrics(), getHotQuestions(range), getReviews()]).then(([overview, , , , hot, review]) => { if (cancelled) return; setData(overview.data.data.metrics); setHotQuestions(hot.data.data.items || []); setReviews(review.data.data.items || []) }).catch((requestError) => { if (!cancelled) setError(apiErrorMessage(requestError, '看板数据加载失败，请稍后重试')) }).finally(() => { if (!cancelled) setLoading(false) }); return () => { cancelled = true } }, [range])
  return <section className="page wide-page"><PageTitle eyebrow="OPERATIONS OBSERVATORY" title="系统观察" description="指标与人工复核队列全部来自管理员接口，不显示本地演示数据。" /><div className="dashboard-toolbar"><div className="segmented">{['today', '7d', '30d'].map((item) => <button type="button" className={range === item ? 'active' : ''} key={item} onClick={() => setRange(item)}>{item === 'today' ? '今日实时' : item === '7d' ? '最近 7 天' : '最近 30 天'}</button>)}</div><span className="sync-label"><RefreshCw size={14} />接口实时返回</span></div>{loading ? <div className="dashboard-empty"><p>正在读取指标...</p></div> : error ? <div className="dashboard-empty"><CircleAlert size={44} /><h2>看板暂时无法加载</h2><p>{error}</p></div> : !data ? <div className="dashboard-empty"><BarChart3 size={44} /><h2>暂无统计数据</h2><p>后端未返回当前周期的指标数据。</p></div> : <div className="dashboard-grid"><section className="chart-card"><h2>指标概览</h2><pre>{JSON.stringify(data, null, 2)}</pre></section><section className="review-queue"><div className="review-head"><h2>待人工复核</h2><StatusBadge tone="danger">{reviews.length} 项</StatusBadge></div>{reviews.length ? reviews.map((item, index) => <article key={String(item.id || index)}><p>{String(item.title || item.question || '复核项目')}</p><small>{String(item.status || 'pending')}</small></article>) : <p className="muted">暂无待复核数据</p>}</section><section className="hot-card"><h2>热门问题</h2>{hotQuestions.length ? hotQuestions.map((item, index) => <div key={String(item.id || index)}><span>{index + 1}</span>{String(item.question || item.title || '问题')}</div>) : <p className="muted">暂无热门问题数据</p>}</section></div>}</section>
}
