import { useMemo, useState } from 'react'
import type { TrendPoint } from '../types/api'
import { formatNumber } from '../utils/format'

/**
 * CampusFlow 服务使用趋势 —— 手写 SVG 折线图（原型截图里的 LIVE FEED）。
 *
 * 为什么不用图表库：设计系统要求「拒绝辉光、只留 1px 结构线与平面色块」，
 * 而且要一个悬停十字准星 + 数值气泡的定制交互，引库反而更难对齐。
 *
 * 三条线口径：
 *   · 对话总量（墨色 #091426，实线粗）
 *   · AI 自主解决（祖母绿 #10B981）
 *   · 人工复核分流（珊瑚红 #E0564C，虚线 —— 只在超过阈值时才该显眼）
 * 后端 `/admin/metrics/trends` 目前只返回 question_count / average_response_ms，
 * ai_resolved / human_routed 缺失时自动退化成单线展示，不画假数据。
 */
export function UsageTrendChart({ points, height = 240 }: { points: TrendPoint[]; height?: number }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const width = 880
  const padX = 44
  const padTop = 18
  const padBottom = 30
  const plotW = width - padX * 2
  const plotH = height - padTop - padBottom

  const { series, max, xAt, yAt, ticks } = useMemo(() => {
    /*
     * `!= null` 而不是 `!== undefined`：后端「不给这条线」有两种可能形态 ——
     * 键不出现（我们后端用的是这个，靠 `@JsonInclude(NON_NULL)`）或显式 null。
     * 只判 undefined 会把后者当成「有数据」，于是画出一条贴着 0 的虚线 ——
     * 一条由 null 伪造出来的数据线。
     */
    const hasBreakdown = points.some((point) => point.ai_resolved != null)
    const defs = [
      { key: 'question_count' as const, label: '对话总量', color: 'var(--ink)', dash: '', show: true },
      { key: 'ai_resolved' as const, label: 'AI 自主解决', color: 'var(--emerald)', dash: '', show: hasBreakdown },
      { key: 'human_routed' as const, label: '人工复核分流', color: 'var(--coral)', dash: '5 4', show: hasBreakdown },
    ].filter((def) => def.show)

    const values = points.flatMap((point) =>
      defs.map((def) => (point[def.key] as number | undefined) ?? 0),
    )
    const upper = Math.max(1, ...values)
    // 顶部留 12% 余量，免得峰值顶到边框
    const scaleMax = Math.ceil((upper * 1.12) / 100) * 100

    const stepX = points.length > 1 ? plotW / (points.length - 1) : plotW
    const xAt = (index: number) => padX + index * stepX
    const yAt = (value: number) => padTop + plotH - (value / scaleMax) * plotH

    const series = defs.map((def) => ({
      ...def,
      path: points
        .map((point, index) => {
          const value = (point[def.key] as number | undefined) ?? 0
          return `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`
        })
        .join(' '),
      areaPath:
        `M${xAt(0).toFixed(1)},${(padTop + plotH).toFixed(1)} ` +
        points.map((point, index) => `L${xAt(index).toFixed(1)},${yAt((point[def.key] as number | undefined) ?? 0).toFixed(1)}`).join(' ') +
        ` L${xAt(points.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`,
    }))

    // 纵轴 4 条刻度线
    const ticks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4
      return { y: padTop + plotH * ratio, value: Math.round(scaleMax * (1 - ratio)) }
    })

    return { series, max: scaleMax, xAt, yAt, ticks }
  }, [points, plotW, plotH, padTop, padX])

  // 「峰值」徽章只在悬停到真正的峰值点时出现。
  // 以前每个悬浮点都挂一颗「峰值」—— 那是把装饰当成了测量，读的人很快就谁都不信了。
  // ⚠️ 必须放在下面的提前 return 之前：hooks 不能在条件返回之后调用，
  // 否则 points 从空到非空的那一次 render，hook 数量变化 → React 直接卸载整棵树。
  const peakIndex = useMemo(() => {
    let best = -1
    let bestValue = -Infinity
    points.forEach((point, index) => {
      const value = (point.question_count as number | undefined) ?? 0
      if (value > bestValue) {
        bestValue = value
        best = index
      }
    })
    return best
  }, [points])

  if (!points.length) {
    return (
      <div className="empty" style={{ padding: '56px 20px' }}>
        趋势数据未返回
      </div>
    )
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null
  const labelStride = Math.ceil(points.length / 7)

  // 读数气泡跟随十字准星（按 x 比例换算成百分比，svg 与容器同宽，直接可用）
  const tipLeft = hoverIndex !== null ? Math.min(86, Math.max(14, (xAt(hoverIndex) / width) * 100)) : 50

  return (
    <div className="trend-wrap">
      <div className="trend-legend">
        {series.map((item) => (
          <span key={item.key}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="trend-svg"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - rect.left) / rect.width
          const x = ratio * width
          const index = Math.round((x - padX) / ((plotW || 1) / Math.max(1, points.length - 1)))
          setHoverIndex(Math.max(0, Math.min(points.length - 1, index)))
        }}
      >
        {/* 网格：极淡的水平线，不加垂直网格，保持学术的克制 */}
        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={padX} x2={width - padX} y1={tick.y} y2={tick.y} stroke="var(--border)" strokeWidth="1" />
            <text x={padX - 10} y={tick.y + 4} textAnchor="end" className="trend-axis">
              {formatNumber(tick.value)}
            </text>
          </g>
        ))}

        {/* AI 自主解决填充：最低透明度，仅作为背景带 */}
        {series[1] && <path className="trend-area" d={series[1].areaPath} fill="var(--emerald)" opacity="0.07" />}

        {series.map((item, itemIndex) =>
          item.dash ? (
            // 虚线（人工复核分流）不能走 dasharray 自绘动画（会破坏虚线节奏），改为淡入
            <path
              key={item.key}
              className="trend-line-dash"
              d={item.path}
              fill="none"
              stroke={item.color}
              strokeWidth="1.6"
              strokeDasharray={item.dash}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <path
              key={item.key}
              className="trend-line"
              pathLength={1}
              d={item.path}
              fill="none"
              stroke={item.color}
              strokeWidth={item.key === 'question_count' ? 2 : 1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animationDelay: `${0.12 * itemIndex}s` }}
            />
          ),
        )}

        {/* 悬停十字准星 */}
        {hovered && hoverIndex !== null && (
          <g>
            <line
              x1={xAt(hoverIndex)}
              x2={xAt(hoverIndex)}
              y1={padTop}
              y2={padTop + plotH}
              stroke="var(--border-strong)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {series.map((item) => (
              <circle
                key={item.key}
                cx={xAt(hoverIndex)}
                cy={yAt((hovered[item.key] as number | undefined) ?? 0)}
                r="3.6"
                fill="var(--surface)"
                stroke={item.color}
                strokeWidth="2"
              />
            ))}
          </g>
        )}

        {/* 横轴标签 */}
        {points.map((point, index) =>
          index % labelStride === 0 ? (
            <text key={point.time} x={xAt(index)} y={height - 8} textAnchor="middle" className="trend-axis">
              {point.time}
            </text>
          ) : null,
        )}
      </svg>

      {/* 悬停数值气泡：跟随准星，只有真峰值才标「峰值」 */}
      {hovered && (
        <div className="trend-tip" style={{ left: `${tipLeft}%` }}>
          <div className="tip-head">
            <b className="mono">{hovered.time}</b>
            {hoverIndex === peakIndex && <span className="badge coral">峰值</span>}
          </div>
          <div className="tip-rows">
            {series.map((item) => (
              <div key={item.key}>
                <span>
                  <i style={{ background: item.color }} />
                  {item.label}
                </span>
                <b className="mono">{formatNumber((hovered[item.key] as number | undefined) ?? 0)}</b>
                <small>次</small>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="trend-foot">
        聚合粒度：5 分钟 · 1 小时
        <span>数据来自 Kafka 总线系统延时投递统计 · 纵轴上限 {formatNumber(max)}</span>
      </p>
    </div>
  )
}
