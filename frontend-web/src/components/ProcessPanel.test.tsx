import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProcessPanel, type TraceItem } from './ProcessPanel'
import { parseWriteTodosArgs } from '../utils/writeTodos'

/**
 * 过程区的「已完成」外壳（09-18）：一整轮跑完后，思考条 + 工具行要收成一行。
 *
 * 这里只渲染初始态（renderToStaticMarkup 不跑 effect、也不能点），
 * 所以覆盖的是「默认长什么样」——折叠/展开的交互留给肉眼与工装页。
 */
const trace: TraceItem[] = [
  { kind: 'tool', tool: 'list_user_folder', callId: 'call-1' },
  { kind: 'result', tool: 'list_user_folder', result: '[原始数据]\n- 课程资料', callId: 'call-1' },
]

/** 后端把模型正文原样塞进 step，句尾通常带换行（见 ProcessPanel 里 trim 的注释） */
const traceWithStep: TraceItem[] = [{ kind: 'step', text: '我先看看有哪些校内知识分类可查。\n' }, ...trace]

/** 两轮「说一句 → 动一次手」：用来验证时间线是**交替**的，而不是前言一堆、工具一堆 */
const traceTwoRounds: TraceItem[] = [
  { kind: 'step', text: '先看看工作区里有什么。\n' },
  { kind: 'tool', tool: 'list_user_folder', callId: 'call-1' },
  { kind: 'result', tool: 'list_user_folder', result: '[原始数据]\n- 课程资料', callId: 'call-1' },
  { kind: 'step', text: '再查一下最新的通知公告。' },
  { kind: 'tool', tool: 'list_notices', callId: 'call-2' },
  { kind: 'result', tool: 'list_notices', result: '[原始数据]\n- 选课通知', callId: 'call-2' },
]

const html = (props: Parameters<typeof ProcessPanel>[0]) => renderToStaticMarkup(<ProcessPanel {...props} />)

describe('ProcessPanel 完成外壳', () => {
  it('跑完收成一行：已完成 + 用时，内部条目默认收起', () => {
    const out = html({ reasoning: '先看看目录', trace, running: false, elapsedMs: 12300 })
    expect(out).toContain('已完成')
    expect(out).toContain('用时 12.3 秒')
    // 默认折叠：思考条与工具行都不该露在外面
    expect(out).not.toContain('已深度思考')
    expect(out).not.toContain('已运行')
  })

  it('用时过 1 分钟换成分秒', () => {
    expect(html({ trace, running: false, elapsedMs: 65000 })).toContain('用时 1 分 05 秒')
  })

  it('流式中不套外壳，工具行实时可见', () => {
    const out = html({ trace, running: true })
    expect(out).not.toContain('已完成')
    // 单个调用的动词跟「本组是否已拿到结果」走（组件内 09-23 起的口径）：
    // 结果已到的行显示「已运行」，但行本身在流式里必须实时可见。
    expect(out).toContain('已运行')
    expect(out).toContain('list_user_folder')
  })

  it('流式中刚发出、还没等到结果的调用显示「正在运行」', () => {
    const out = html({ trace: [{ kind: 'tool', tool: 'list_notices', callId: 'call-9' }], running: true })
    expect(out).toContain('正在运行')
    expect(out).toContain('list_notices')
  })

  it('只有思考条（历史回放，无工具无用时）不套外壳', () => {
    const out = html({ reasoning: '一二三', running: false })
    expect(out).not.toContain('已完成')
    expect(out).toContain('已深度思考 · 3 字')
  })

  it('失败时不吹「已完成」', () => {
    const out = html({ trace, running: false, elapsedMs: 8400, failed: true })
    expect(out).toContain('已中断')
    expect(out).not.toContain('已完成')
  })

  it('跑完连前言一起收起：正文前不留裸露的过程条目', () => {
    const out = html({ reasoning: '先看看目录', trace: traceWithStep, running: false, elapsedMs: 54600 })
    expect(out).toContain('已完成')
    expect(out).toContain('用时 54.6 秒')
    expect(out).not.toContain('我先看看有哪些校内知识分类可查。')
  })

  it('流式中前言照旧成文展示，句尾换行被裁掉（pre-wrap 下会多撑一个空行）', () => {
    const out = html({ trace: traceWithStep, running: true })
    expect(out).not.toContain('已完成')
    expect(out).toContain('我先看看有哪些校内知识分类可查。</p>')
    expect(out).not.toContain('可查。\n</p>')
  })

  it('时间线交替：一条前言，紧跟一条它引发的工具调用', () => {
    const out = html({ trace: traceTwoRounds, running: true })
    // 顺序必须是 前言1 → 工具1 → 前言2 → 工具2（旧版是前言堆在前、工具栏在后）
    const at = (needle: string) => out.indexOf(needle)
    expect(at('先看看工作区里有什么。')).toBeGreaterThanOrEqual(0)
    expect(at('先看看工作区里有什么。')).toBeLessThan(at('list_user_folder'))
    expect(at('list_user_folder')).toBeLessThan(at('再查一下最新的通知公告。'))
    expect(at('再查一下最新的通知公告。')).toBeLessThan(at('list_notices'))
  })
})

/** 09-19 十七改：思考按波次插进时间线 —— 深度思考 → 前言 → 工具 → 深度思考 … 原序交替 */
const traceWithThink: TraceItem[] = [
  { kind: 'think', text: '先想想要查什么。' },
  { kind: 'step', text: '先看看工作区里有什么。\n' },
  { kind: 'tool', tool: 'list_user_folder', callId: 'call-1' },
  { kind: 'result', tool: 'list_user_folder', result: '[原始数据]\n- 课程资料', callId: 'call-1' },
  { kind: 'think', text: '目录拿到了，再查通知。' },
  { kind: 'step', text: '再查一下最新的通知公告。' },
  { kind: 'tool', tool: 'list_notices', callId: 'call-2' },
  { kind: 'result', tool: 'list_notices', result: '[原始数据]\n- 选课通知', callId: 'call-2' },
]

describe('ProcessPanel 思考波次（十七改）', () => {
  it('思考条目按原位插进时间线：深度思考 → 前言 → 工具交替', () => {
    const out = html({ reasoning: '先想想要查什么。目录拿到了，再查通知。', trace: traceWithThink, running: true })
    const at = (needle: string) => out.indexOf(needle)
    expect(at('深度思考')).toBeGreaterThanOrEqual(0)
    expect(at('深度思考')).toBeLessThan(at('先看看工作区里有什么。'))
    expect(at('先看看工作区里有什么。')).toBeLessThan(at('list_user_folder'))
  })

  it('两波思考是两个条目，且默认折叠不露全文（不再糊一面独白墙）', () => {
    const out = html({ trace: traceWithThink, running: true })
    expect(out.split('深度思考').length - 1).toBeGreaterThanOrEqual(2)
    expect(out).not.toContain('先想想要查什么。')
    expect(out).not.toContain('目录拿到了，再查通知。')
  })

  it('思考进了时间线就不再整块重复（顶部思考块只是历史回放的兜底）', () => {
    // running:true 时若兜底误开，顶部会出现旧思考条「思考中…」；全文「先想想要查什么」也不该露
    const out = html({ reasoning: '先想想要查什么。目录拿到了，再查通知。', trace: traceWithThink, running: true })
    expect(out).not.toContain('思考中…')
  })

  it('流式中正在生长的那波显示「深度思考中…」，且默认展开直接看全文（09-23 拍板）', () => {
    const out = html({ trace: [{ kind: 'think', text: '还没想完' }], running: true })
    expect(out).toContain('深度思考中…')
    expect(out).toContain('还没想完')
  })

  it('只有最后一波默认展开：已断波的历史思考仍折叠，想完自动收起', () => {
    // 前两波后面跟了 step/tool（已断波）→ 折叠；追加第三波在生长 → 展开
    const out = html({ trace: [...traceWithThink, { kind: 'think', text: '收尾的第三波思考。' }], running: true })
    expect(out).not.toContain('先想想要查什么。')
    expect(out).not.toContain('目录拿到了，再查通知。')
    expect(out).toContain('收尾的第三波思考。')
    // 思考完毕（最后一波后跟了 step）→ 也收起来
    const done = html({ trace: [...traceWithThink, { kind: 'step', text: '动手查。\n' }], running: true })
    expect(done).not.toContain('目录拿到了，再查通知。')
  })

  it('没有思考波时（历史回放）保留旧思考条：已深度思考 · N 字', () => {
    const out = html({ reasoning: '一二三', running: false })
    expect(out).toContain('已深度思考 · 3 字')
  })
})

/** 10-09：write_todos 不进时间线 —— 清单渲染成输入框上方的 TodoPanel（见 TodoPanel 与
 * ConversationPage.liveTodos）；时间线侧的契约只剩「write_todos 不挤成通用工具行」，由页面层保证。 */
describe('parseWriteTodosArgs（event:tool args 的防御性解析）', () => {
  it('正常 JSON 解析出清单', () => {
    expect(parseWriteTodosArgs('{"todos":[{"content":"查课","status":"pending"}]}')).toEqual([
      { content: '查课', status: 'pending' },
    ])
  })
  it('空串/坏 JSON/形状不对/空列表一律 null（调用方退回通用工具行）', () => {
    expect(parseWriteTodosArgs(undefined)).toBeNull()
    expect(parseWriteTodosArgs('')).toBeNull()
    expect(parseWriteTodosArgs('{"todos":')).toBeNull()
    expect(parseWriteTodosArgs('{"todos":[{"content":"","status":"pending"}]}')).toBeNull()
    expect(parseWriteTodosArgs('{"todos":[{"content":"x","status":"doing"}]}')).toBeNull()
    expect(parseWriteTodosArgs('{"todos":[]}')).toBeNull()
  })
  it('content 首尾空白被裁掉', () => {
    expect(parseWriteTodosArgs('{"todos":[{"content":" 查课 ","status":"pending"}]}')).toEqual([
      { content: '查课', status: 'pending' },
    ])
  })
})
