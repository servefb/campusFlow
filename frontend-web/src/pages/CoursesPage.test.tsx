import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CoursesPage } from './CoursesPage'

/**
 * 课程页的初始态（renderToStaticMarkup 不跑 effect，所以只覆盖首次渲染）：
 * 页面骨架、搜索与学期控件、右侧引导文案。加载完成后的列表与错误态依赖真实请求，留给联调验收。
 */
describe('CoursesPage initial render', () => {
  const markup = renderToStaticMarkup(<CoursesPage />)

  it('renders the heading and search control', () => {
    expect(markup).toContain('<h1>课程目录</h1>')
    expect(markup).toContain('aria-label="搜索课程"')
    expect(markup).toContain('aria-label="课程类型"')
  })

  it('shows the loading state for the catalog before data arrives', () => {
    expect(markup).toContain('正在读取课程目录...')
  })

  it('prompts the user to pick a course before showing offerings', () => {
    expect(markup).toContain('选择一门课程')
  })
})
