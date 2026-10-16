/**
 * .docx 正文提取（10-07，零依赖）：docx 本质是 zip 包，正文在 word/document.xml。
 * 浏览器端手工解析 ZIP 目录（只读）+ 原生 DecompressionStream('deflate-raw') 解压，
 * 再按段落抽 w:t 文本 —— 供右侧边栏预览 Word 文档。不引 mammoth 这类转换库：
 * 预览要的是「能读」，段落级文本够了；老 .doc 是二进制复合文档，解析不了，调用方措辞降级。
 */

/** 仅 OOXML 的 .docx 可解；老 .doc 不行 */
export const isDocxPath = (path: string) => /\.docx$/i.test(path)

/** 浏览器 <img> 能直接渲染的位图/矢量图（附件胶囊悬停缩略图与右侧边栏共用这套口径） */
export const isImagePath = (path: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path)

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  // ① 找 EOCD（0x06054b50）：从尾部往回扫（ZIP 注释区理论上最长 64KB，扫 66KB 足够）
  let eocd = -1
  const scanFrom = Math.max(0, bytes.length - 66_000)
  for (let i = bytes.length - 22; i >= scanFrom; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 docx（zip）文件')
  // ② 遍历中央目录，找 word/document.xml
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  let target: { method: number; compSize: number; localOffset: number } | null = null
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compSize = view.getUint32(offset + 20, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen))
    if (name === 'word/document.xml') {
      target = { method, compSize, localOffset }
      break
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  if (!target) throw new Error('docx 里没有正文（word/document.xml）')
  // ③ 本地头：30 字节 + 文件名 + extra（长度与中央目录各自独立，要重新读）
  const nameLen = view.getUint16(target.localOffset + 26, true)
  const extraLen = view.getUint16(target.localOffset + 28, true)
  const dataStart = target.localOffset + 30 + nameLen + extraLen
  const compressed = bytes.subarray(dataStart, dataStart + target.compSize)
  let xmlBytes: Uint8Array
  if (target.method === 0) {
    xmlBytes = compressed // stored
  } else if (target.method === 8) {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer())
  } else {
    throw new Error('docx 用了不支持的压缩方式')
  }
  // ④ 按段落抽文本：w:p 一段一行，段落内拼 w:t，tab/br 转换行。
  //    表格单元格也是 w:p，会各自成行（不保留表格线，预览够用）。
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), 'text/xml')
  const lines: string[] = []
  for (const p of doc.getElementsByTagName('w:p')) {
    let line = ''
    for (const node of p.getElementsByTagName('*')) {
      if (node.localName === 't') line += node.textContent ?? ''
      else if (node.localName === 'tab') line += '\t'
      else if (node.localName === 'br') line += '\n'
    }
    lines.push(line)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
