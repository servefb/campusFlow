import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'

/**
 * 思考过程展示块（09-16 用户拍板）：
 * - 思考中（还没有正文 token）：默认只占一行，灰色实时预览思考尾部，点击可展开全文；
 * - 思考完成（正文开始输出或 done）：默认折叠成「已深度思考 · N 字」一行，点击展开/收起全文。
 * 对话页与历史回放页共用；历史回放里 thinking 恒为 false（读的是落库的完整思考）。
 */
export function ReasoningBlock({ reasoning, thinking }: { reasoning: string; thinking: boolean }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`convo-think${thinking ? ' live' : ''}`}>
      <button type="button" className="convo-think-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {thinking ? (
          <Loader2 size={12} className="convo-spin" />
        ) : (
          <ChevronDown size={12} className={`convo-think-chev${expanded ? ' open' : ''}`} />
        )}
        {thinking ? '思考中' : `已深度思考 · ${reasoning.length} 字`}
      </button>
      {thinking && !expanded && <p className="convo-think-line">…{reasoning.slice(-140).replace(/\s+/g, ' ')}</p>}
      {expanded && <div className="convo-think-full">{reasoning}</div>}
    </div>
  )
}
