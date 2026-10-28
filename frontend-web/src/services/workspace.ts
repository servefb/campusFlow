import { aiHttp } from './http'
import type { ApiSuccess } from '../types/api'

/**
 * 全站唯一的主智能体（09-23 定）。
 *
 * 后端图里已只剩 `common_agent_node` 一个节点，它自己拆解问题、派子智能体、整合成一份回答；
 * 子智能体由框架托管、不进图，用户既看不见也选不了别的智能体。所以前端**不再拉 `/agents`**
 * （那个接口下发的是 agents 表里 router/policy/academic/workflow 四行历史数据，
 * 选出来的 key 后端也已经没有对应节点了），名字与说明在这里固定。
 */
export const MAIN_AGENT = {
  key: 'campusflow_agent',
  name: 'Campus Flow',
  description: '理解问题、按需拆分、派子智能体调研，最后整合成一份回答。',
} as const

export interface WorkspaceSummary { domains?: Array<{ key: string; name: string; hint?: string }>; quick_entries: Array<{ key: string; title: string; category?: string; prompt: string }>; recent_conversations: Array<{ id: string | number; title: string; agent_name?: string; updated_at: string }>; hot_topics: string[] }
export const getWorkspaceSummary = () => aiHttp.get<ApiSuccess<WorkspaceSummary>>('/workspace/summary')

/**
 * 工作区文件夹选择：浏览器拿不到本机绝对路径（`<input type="file">` 只给 File 对象、
 * File System Access API 只给 handle），所以浏览改由后端导航 —— 前端从根开始逐层点选，
 * 提交给 stream 接口的 workspace_path 是 `<rootKey>:<相对路径>`（如 `d:exam`）。
 */
export interface WorkspaceRoot {
  key: string
  name: string
}

/** 目录条目：`dir` 可点选进入，`file` 仅展示以帮助用户确认选对了位置。 */
export interface WorkspaceEntry {
  name: string
  type: 'dir' | 'file'
  size?: number
}

export interface WorkspaceListing {
  root: string
  path: string
  /** 上一级目录的相对路径；空串表示已在根目录。 */
  parent: string
  entries: WorkspaceEntry[]
  truncated: boolean
}

export const getWorkspaceRoots = () => aiHttp.get<ApiSuccess<{ roots: WorkspaceRoot[] }>>('/workspace/dirs/roots')

export const browseWorkspaceDir = (root: string, path = '') =>
  aiHttp.get<ApiSuccess<WorkspaceListing>>('/workspace/dirs', { params: { root, path } })

/**
 * 「已修改的文件」抽屉预览（10-07）：读用户工作文件夹里的一个文本文件。
 * workspace 是提问时提交的 `<root>:<相对路径>`（决定 agent 的 /user/ 路由到哪）；
 * path 是虚拟路径去掉 /user/ 前缀后的相对路径。二进制/超大文件后端不报错，
 * 返回 binary / too_large 标记 + 空内容，调用方措辞降级。
 */
export interface WorkspaceFilePreview { name: string; size: number; modified_at?: string; content: string; truncated: boolean; binary: boolean; too_large: boolean }

export const readWorkspaceFile = (workspace: string, path: string) =>
  aiHttp.get<ApiSuccess<WorkspaceFilePreview>>('/workspace/file', { params: { workspace, path } })

/**
 * 文件本体直出（10-07，raw=1）：供前端解压 .docx 提取正文等二进制预览。
 * 后端仍做工作文件夹越界校验；超过 10MB 回 400。Blob 由调用方消费。
 */
export const fetchWorkspaceFileRaw = (workspace: string, path: string) =>
  aiHttp.get<Blob>('/workspace/file', { params: { workspace, path, raw: 1 }, responseType: 'blob' })
