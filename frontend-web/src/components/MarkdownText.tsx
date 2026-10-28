import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Agent 回答是 Markdown（加粗 / 列表 / 标题 / 表格…），统一走本组件渲染。
 * react-markdown 输出 React 元素而非 innerHTML，流式未闭合语法也只会降级显示，无 XSS 面。
 * 09-15：对话页 assistant 消息原先按纯文本 <p> 渲染，`**` 和 `- ` 原样露出，改走本组件。
 */
export const MarkdownText = memo(function MarkdownText({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
})
