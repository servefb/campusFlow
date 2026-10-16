#!/usr/bin/env node
/**
 * 把 docs/*.md 渲染成 pdf/*.pdf，供「只吃 PDF 的解析器」使用。
 *
 * 为什么要它：库里 `file_kind = knowledge_source` 的种子数据全是 application/pdf，
 * 解析器名也写着 pdf-text。如果后端解析链路只认 PDF，md 原文就没法直接喂进去；
 * 这个脚本用本机 Chrome 的 printToPDF 把同一份文本排版成 A4，正文一字不改。
 *
 * 用法：
 *   node .\知识库测试数据\build-pdf.mjs
 *
 * 依赖：本机已装 Chrome + 全局 puppeteer-core（路径见下方常量，换机器改这两行即可）。
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = join(HERE, 'docs')
const OUT = join(HERE, 'pdf')

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PUPPETEER = process.env.PUPPETEER_CORE ?? 'C:/Users/Lenovo/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const inline = (text) =>
  escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')

/** 极简 markdown：本项目语料只用到标题、列表、表格、引用、段落。 */
const toHtml = (markdown) => {
  const out = []
  let list = null // 'ul' | 'ol'
  let table = []

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }
  const flushTable = () => {
    if (!table.length) return
    const rows = table.filter((row) => !/^\|[\s:|-]+\|$/.test(row))
    const cells = rows.map((row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell.trim())))
    const [head, ...body] = cells
    out.push(
      `<table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>` +
        body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('') +
        '</tbody></table>',
    )
    table = []
  }

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList()
      table.push(line.trim())
      continue
    }
    flushTable()

    if (!line.trim()) {
      closeList()
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`)
      continue
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      if (list !== 'ul') {
        closeList()
        out.push('<ul>')
        list = 'ul'
      }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      if (list !== 'ol') {
        closeList()
        out.push('<ol>')
        list = 'ol'
      }
      out.push(`<li>${inline(ordered[1])}</li>`)
      continue
    }
    closeList()
    if (/^>\s?/.test(line)) {
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`)
      continue
    }
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  flushTable()
  return out.join('\n')
}

const page = (title, body) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 22mm 20mm 20mm; }
  body { font-family: "Microsoft YaHei","SimSun",serif; font-size: 12pt; line-height: 1.75; color: #1a1a1a; }
  h1 { font-size: 20pt; text-align: center; margin: 0 0 18pt; letter-spacing: 2px; }
  h2 { font-size: 14pt; margin: 20pt 0 8pt; }
  h3 { font-size: 12.5pt; margin: 14pt 0 6pt; }
  h4 { font-size: 12pt; margin: 12pt 0 6pt; }
  p { margin: 6pt 0; text-indent: 2em; }
  ul, ol { margin: 6pt 0 6pt 1.6em; padding: 0; }
  li { margin: 4pt 0; }
  table { width: 100%; border-collapse: collapse; margin: 10pt 0; font-size: 11pt; }
  th, td { border: 1px solid #999; padding: 5pt 8pt; text-align: left; }
  th { background: #f2f4f7; }
  blockquote { margin: 10pt 0; padding: 6pt 12pt; border-left: 3px solid #c8cdd6; color: #4a5568; }
  blockquote p { text-indent: 0; }
</style></head><body>
${body}
</body></html>`

const main = async () => {
  const puppeteer = (await import(pathToFileURL(PUPPETEER).href)).default
  await mkdir(OUT, { recursive: true })

  const files = (await readdir(DOCS)).filter((name) => name.endsWith('.md')).sort()
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  })

  try {
    const report = []
    for (const file of files) {
      const markdown = await readFile(join(DOCS, file), 'utf8')
      const title = (markdown.match(/^#\s+(.+)$/m)?.[1] ?? file).trim()
      const htmlPath = join(OUT, '_html', `${file.replace(/\.md$/, '')}.html`)
      await mkdir(join(OUT, '_html'), { recursive: true })
      await writeFile(htmlPath, page(title, toHtml(markdown)), 'utf8')

      const tab = await browser.newPage()
      await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
      const pdfPath = join(OUT, file.replace(/\.md$/, '.pdf'))
      await tab.pdf({ path: pdfPath, format: 'A4', printBackground: true })
      await tab.close()

      const bytes = (await readFile(pdfPath)).byteLength
      report.push(`${file} → ${pdfPath.split(/[\\/]/).pop()}  ${bytes}B`)
      console.log(`- ${file} 《${title}》  ${bytes}B`)
    }
    console.log(`\n共生成 ${report.length} 个 PDF，输出目录：${OUT}`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
