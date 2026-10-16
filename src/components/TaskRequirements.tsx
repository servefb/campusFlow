import { AlertCircle, CheckCircle2, FileUp, UploadCloud } from 'lucide-react'
import type { TaskRequirement } from '../types/api'

interface TaskRequirementsProps {
  items: TaskRequirement[]
  uploaded: boolean
  onUpload: () => void
}

const statusText = (item: TaskRequirement) => {
  if (item.status === 'accepted' || item.status === 'passed' || item.material_id) return '已核验'
  if (item.status === 'missing') return '待提交'
  if (item.status === 'rejected') return '需重新提交'
  return item.status || '待校验'
}

const typeLabel = (types?: string[]) => {
  if (!types?.length) return '支持常见文件格式'
  return types.map((type) => { const parts = type.split('/'); return (parts[parts.length - 1] || '').toUpperCase() }).filter(Boolean).join(' / ')
}

export function TaskRequirements({ items, uploaded, onUpload }: TaskRequirementsProps) {
  const missing = items.filter((item) => item.status === 'missing' && !item.material_id)
  const accepted = items.filter((item) => !missing.includes(item))
  const pendingCount = missing.length

  return <div className="task-requirements">
    <div className="task-requirements-heading"><h3 className="section-title">所需材料核验清单 ({Math.max(items.length - pendingCount, 0)}/{items.length})</h3>{pendingCount > 0 && <em>尚欠 {pendingCount} 份材料</em>}</div>
    <div className="task-requirement-list">
      {accepted.map((item, index) => <div className="task-requirement task-requirement-accepted" key={String(item.id ?? index)}><CheckCircle2 size={17} /><div><strong>{item.name || '材料'}</strong><small>{statusText(item)} {item.material_id ? '· 系统自动识别' : ''}</small></div><span className="task-requirement-code">{item.status === 'accepted' || item.status === 'passed' ? 'PASS' : 'AUTO'}</span></div>)}
      {missing.map((item, index) => <div className="task-requirement-missing" key={String(item.id ?? index)}><div className="task-requirement-missing-head"><strong><AlertCircle size={16} /> {item.name || '待补充材料'}</strong><span>{item.required === false ? '选填' : '必填项'}</span></div><p>{item.description || `请上传${item.name || '指定材料'}。`} 支持 {typeLabel(item.allowed_types)}{item.max_size_mb ? `，文件不超过 ${item.max_size_mb}MB` : ''}。</p><label className={`task-upload-box${uploaded ? ' uploaded' : ''}`}><input type="file" accept={item.allowed_types?.join(',')} onChange={onUpload} /><UploadCloud size={22} /><strong>{uploaded ? '已选取待上传文件' : '选择或拖入任务材料'}</strong><small>{uploaded ? '文件将在提交时随任务一起上传' : `${typeLabel(item.allowed_types)}${item.max_size_mb ? ` · ${item.max_size_mb}MB以内` : ''}`}</small></label><div className="task-upload-actions"><button type="button"><FileUp size={13} /> 选择文件</button><button type="button">扫码拍照上传</button></div></div>)}
    </div>
    {items.length === 0 && <p className="task-requirements-empty">接口未返回材料要求</p>}
  </div>
}
