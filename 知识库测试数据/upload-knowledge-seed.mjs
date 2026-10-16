#!/usr/bin/env node
/**
 * 把「知识库测试数据」批量灌入 Campus Flow 知识库。
 *
 * 走的是接口文档里现成的两条接口，不碰数据库：
 *   1. POST {base}/files/presign            （multipart，purpose=knowledge_source）→ 拿 file_id
 *   2. POST {base}/knowledge/admin/documents（JSON，带 file_id）        → 拿 document_id + job_id
 *
 * 用法（先起后端，默认 http://127.0.0.1:8080/api/v1）：
 *   node .\知识库测试数据\upload-knowledge-seed.mjs --token=<管理员 access token> --skip-existing
 *
 * 常用参数：
 *   --base=<url>      接口前缀，默认 http://127.0.0.1:8080/api/v1
 *   --token=<jwt>     管理员 access token；也可用环境变量 CF_TOKEN
 *   --ext=md|pdf      上传哪种文件，默认 md（pdf 需先跑 build-pdf.mjs）
 *   --skip-existing   先拉一遍文档列表，标题已存在的直接跳过（避免撞文号唯一索引）
 *   --only=01,05      只跑指定前缀的文档，便于单篇排查
 *   --dry-run         只打印将要发起的请求，不真的调用
 *
 * 依赖：Node 18+ 内置 fetch / FormData / Blob，无需安装任何包。
 */

import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

const args = Object.fromEntries(
  process.argv.slice(2).map((raw) => {
    const [key, ...rest] = raw.replace(/^--/, '').split('=')
    return [key, rest.length ? rest.join('=') : true]
  }),
)

const BASE = String(args.base ?? process.env.CF_BASE ?? 'http://127.0.0.1:8080/api/v1').replace(/\/+$/, '')
const TOKEN = String(args.token ?? process.env.CF_TOKEN ?? '')
const EXT = String(args.ext ?? 'md').toLowerCase()
const SKIP_EXISTING = Boolean(args['skip-existing'])
const DRY_RUN = Boolean(args['dry-run'])
const ONLY = args.only ? String(args.only).split(',').map((item) => item.trim()) : null

if (!TOKEN && !DRY_RUN) {
  console.error('缺少管理员 token：加 --token=<jwt> 或设置环境变量 CF_TOKEN')
  process.exit(1)
}
if (!['md', 'pdf'].includes(EXT)) {
  console.error(`--ext 只支持 md 或 pdf，收到：${EXT}`)
  process.exit(1)
}

const MIME = { md: 'text/markdown', pdf: 'application/pdf' }
const SOURCE_DIR = join(HERE, EXT === 'md' ? 'docs' : 'pdf')

/** metadata.csv 是纯 UTF-8、字段内不含半角逗号，直接按逗号切即可。 */
const parseCsv = (text) => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  const header = lines.shift().split(',')
  return lines.map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(header.map((key, index) => [key.trim(), (cells[index] ?? '').trim()]))
  })
}

const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...headers },
    body,
  })
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { raw: text.slice(0, 300) }
  }
  if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
    const error = new Error(`${method} ${path} → HTTP ${response.status} ${JSON.stringify(payload).slice(0, 300)}`)
    error.status = response.status
    throw error
  }
  return payload?.data ?? payload
}

const existingTitles = async () => {
  if (!SKIP_EXISTING) return new Set()
  const data = await api('/knowledge/documents?page=1&page_size=200')
  const items = Array.isArray(data?.items) ? data.items : []
  return new Set(items.map((item) => String(item.title ?? '').trim()))
}

const uploadFile = async (row, buffer) => {
  const form = new FormData()
  form.append('filename', row.file)
  form.append('content_type', MIME[EXT])
  form.append('size_bytes', String(buffer.byteLength))
  form.append('purpose', 'knowledge_source')
  form.append('file', new Blob([buffer], { type: MIME[EXT] }), row.file)
  const data = await api('/files/presign', { method: 'POST', body: form })
  const fileId = data.file_id ?? data.id
  if (!fileId) throw new Error(`presign 未返回 file_id：${JSON.stringify(data).slice(0, 200)}`)
  return fileId
}

const createDocument = async (row, fileId, slug) => {
  const body = {
    title: row.title,
    issuer_id: Number(row.issuer_organization_id),
    category_id: Number(row.category_id),
    visibility: row.visibility,
    effective_from: row.effective_from,
    file_id: fileId,
  }
  if (row.document_no) body.document_no = row.document_no
  return api('/knowledge/admin/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `seed-knowledge-${slug}` },
    body: JSON.stringify(body),
  })
}

const main = async () => {
  const rows = parseCsv(await readFile(join(HERE, 'metadata.csv'), 'utf8'))
  const selected = ONLY ? rows.filter((row) => ONLY.some((prefix) => row.file.startsWith(prefix))) : rows
  const done = await existingTitles()

  console.log(`接口前缀：${BASE}`)
  console.log(`文件目录：${SOURCE_DIR}（${EXT}）`)
  console.log(`待处理：${selected.length} 篇${SKIP_EXISTING ? '，已开启标题去重' : ''}\n`)

  const result = []
  for (const row of selected) {
    const slug = row.file.replace(/\.[^.]+$/, '')
    const path = join(SOURCE_DIR, row.file.replace(/\.md$/, `.${EXT}`))
    if (SKIP_EXISTING && done.has(row.title)) {
      result.push({ ...row, status: '跳过（标题已存在）' })
      console.log(`- ${slug}  跳过：库中已有《${row.title}》`)
      continue
    }
    let buffer
    try {
      const info = await stat(path)
      if (!info.isFile()) throw new Error('不是文件')
      buffer = await readFile(path)
    } catch (error) {
      result.push({ ...row, status: `读取失败 ${error.message}` })
      console.log(`- ${slug}  读取失败：${path}`)
      continue
    }

    if (DRY_RUN) {
      result.push({ ...row, status: 'dry-run' })
      console.log(`- ${slug}  [dry-run] ${buffer.byteLength}B → presign → admin/documents（${row.title}）`)
      continue
    }

    try {
      const fileId = await uploadFile(row, buffer)
      const created = await createDocument(row, fileId, slug)
      result.push({ ...row, status: `#{created.document_id ?? created.documentId ?? '?'} 作业 ${created.job_id ?? created.jobId ?? '-'}` })
      console.log(`- ${slug}  已创建：document_id=${created.document_id ?? '?'} job_id=${created.job_id ?? '?'} file_id=${fileId}`)
    } catch (error) {
      result.push({ ...row, status: error.status === 409 ? '冲突（文号或标题重复）' : `失败 ${error.message}` })
      console.log(`- ${slug}  ${error.status === 409 ? '409 冲突：文号已被占用，可加 --skip-existing 或改 metadata.csv 的文号' : error.message}`)
    }
  }

  const failed = result.filter((item) => /失败|冲突/.test(item.status))
  console.log(`\n完成：${result.length - failed.length}/${result.length} 篇成功，${failed.length} 篇需人工处理`)
  if (failed.length) {
    console.log('需人工处理的条目：')
    failed.forEach((item) => console.log(`  · ${item.file}  ${item.status}`))
  }
  console.log('\n后续：等 knowledge_jobs 跑到 completed 再验证检索，用例见「检索验证用例.md」。')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
