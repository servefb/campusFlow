import { describe, expect, it } from 'vitest'
import { workspaceName } from './workspacePath'

/**
 * 「只显示最后一级文件夹名」的口径（09-18）。
 * 两处 UI 共用：侧边栏工作区分组的组标题、输入框工具条的工作区 chip。
 */
describe('工作区名（取路径最后一段文件夹）', () => {
  it('三种路径写法都要认得出来', () => {
    // 前端工作区选择器提交的 `<盘符>:<相对路径>`
    expect(workspaceName('d:worker-space/WebstormProjects/campusflow')).toBe('campusflow')
    // 盘符 + 单段
    expect(workspaceName('d:exam')).toBe('exam')
    // Windows 绝对路径（反斜杠）—— 只 split('/') 的话这里会整串返回
    expect(workspaceName('D:\\worker-space\\WebstormProjects\\campusflow')).toBe('campusflow')
    // 类 Unix 绝对路径
    expect(workspaceName('/home/me/proj')).toBe('proj')
    // 末尾带分隔符
    expect(workspaceName('d:exam/')).toBe('exam')
    expect(workspaceName('d:exam\\')).toBe('exam')
  })

  it('取不出文件夹名时返回空串，不编一个名字', () => {
    // 盘根（选择器已禁止选它，但接口可能给出）
    expect(workspaceName('d:')).toBe('')
    expect(workspaceName('D:\\')).toBe('')
    expect(workspaceName('')).toBe('')
    expect(workspaceName('   ')).toBe('')
  })
})
