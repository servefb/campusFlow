import { http } from './http'
import type { ApiSuccess } from '../types/api'

/** 上传结果：服务端登记完成后返回。`status` 通常先为 `scanning`，安全扫描通过后变 `ready`。 */
export interface UploadedFile {
  file_id: number | string
  filename: string
  content_type: string
  size_bytes: number
  purpose: string
  status: string
}

/**
 * 上传文件：**一次 multipart POST** 把文件与元数据一起交给 `POST /files/presign`，直接拿到 `file_id`。
 *
 * ⚠️ 必须显式声明 `Content-Type: multipart/form-data`，不能依赖「浏览器会自动设」——
 * `http` 实例默认是 `application/json`，而 axios 的 transformRequest 里有一条：
 * `isFormData ? (hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data)`
 * （axios 1.20 `lib/defaults/index.js:57`）。只要 Content-Type 里含 `application/json`，
 * **FormData 会被序列化成 JSON**，文件变成一个空对象 —— 表现为后端拿到的文件是空的。
 * 声明成 multipart 后，XHR 适配器会清掉这个头，交给浏览器补上带 boundary 的真实值。
 *
 * `purpose` 决定文件归属哪类业务（`task_material` / `avatar`，见接口文档 9. 文件接口）。
 */
export const uploadFile = async (file: File, purpose: string): Promise<number | string> => {
  const form = new FormData()
  form.append('filename', file.name)
  form.append('content_type', file.type || 'application/octet-stream')
  form.append('size_bytes', String(file.size))
  form.append('purpose', purpose)
  form.append('file', file)
  const { data } = await http.post<ApiSuccess<UploadedFile>>('/files/presign', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data.data.file_id
}
