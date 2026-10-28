import { describe, expect, it } from 'vitest'
import { addAttachments, clearAttachments, estimateAttachmentTokens, formatAttachmentSize, formatAttachmentTokens, getAttachmentFiles, getAttachments, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BYTES_HARD, removeAttachment } from './attachments'

/**
 * 附件服务（09-19 二阶）只覆盖**本地可判定的部分**：
 * 入参校验（格式 / 体积）、体积与 token 文案、以及「送出去的是文件本体」这条契约。
 * 真正的 multipart 发送由真机工装验证（`.workbuddy/preview/_attach-drag.cjs`）。
 * 注意：store 是模块级单例，用例之间共享状态（沿用上一版写法，不额外做 reset）。
 */
const makeFile = (name: string, size = 1024, type = '') => {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('attachments', () => {
  it('拒收白名单外的扩展名，且不为它建胶囊', () => {
    const before = getAttachments().length
    const rejected = addAttachments([makeFile('木马.exe', 1024, 'application/x-msdownload')])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('格式不支持')
    expect(getAttachments()).toHaveLength(before)
  })

  it('体积上限：压线放行、越线拒收，且被拒的不建胶囊', () => {
    // 期望值全部从常量推导（口径调过：50MB → 30 万 → 50 万 token），别把数字写死在这里
    expect(addAttachments([makeFile('刚好压线.pdf', MAX_ATTACHMENT_BYTES, 'application/pdf')])).toEqual([])
    const cardsBefore = getAttachments().length
    const rejected = addAttachments([makeFile('超大材料.pdf', MAX_ATTACHMENT_BYTES + 1024, 'application/pdf')])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('太大')
    // 文案里两种单位都要有：用户按 token 想、代码按字节拦
    expect(rejected[0]).toContain(formatAttachmentSize(MAX_ATTACHMENT_BYTES))
    expect(rejected[0]).toContain(formatAttachmentTokens(MAX_ATTACHMENT_BYTES))
    expect(getAttachments()).toHaveLength(cardsBefore)
  })

  it('内存硬闸门：生效上限取两者之小，绝不放行超过硬闸门的单个文件', () => {
    // 服务端要把文件读进内存解析 —— 就算以后把上下文预算调大，这条线也得压着
    expect(MAX_ATTACHMENT_BYTES).toBeLessThanOrEqual(MAX_ATTACHMENT_BYTES_HARD)
    expect(addAttachments([makeFile('巨无霸.pdf', MAX_ATTACHMENT_BYTES_HARD + 1, 'application/pdf')])).toHaveLength(1)
  })

  it('token 折算与文案：3 字节/token，上万后换「万 token」', () => {
    expect(estimateAttachmentTokens(3000)).toBe(1000)
    expect(estimateAttachmentTokens(3001)).toBe(1001)
    expect(formatAttachmentTokens(3000)).toBe('1000 token')
    // 上限已在六位数 token 量级，文案该走「万」这一档
    expect(formatAttachmentTokens(MAX_ATTACHMENT_BYTES)).toMatch(/^\d+ 万 token$/)
  })

  it('MIME 为空时按扩展名放行；空入参不报错', () => {
    expect(addAttachments([])).toEqual([])
    // 拖拽本地文件时 file.type 常为空，靠扩展名兜底
    expect(addAttachments([makeFile('成绩单.txt', 1024, '')])).toEqual([])
  })

  it('体积文案：1MB 以下按 KB、向上取整，1MB 以上保留一位小数', () => {
    expect(formatAttachmentSize(0)).toBe('1 KB')
    expect(formatAttachmentSize(1536)).toBe('2 KB')
    expect(formatAttachmentSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })

  it('送出去的是文件本体（不是 id）：顺序 = 加入顺序，移除与清空都生效', () => {
    clearAttachments()
    const a = makeFile('成绩单.pdf', 2048, 'application/pdf')
    const b = makeFile('在读证明.jpg', 4096, 'image/jpeg')
    addAttachments([a, b])
    expect(getAttachmentFiles()).toEqual([a, b])

    removeAttachment(getAttachments()[0].key)
    expect(getAttachmentFiles()).toEqual([b])

    clearAttachments()
    expect(getAttachmentFiles()).toEqual([])
  })
})
