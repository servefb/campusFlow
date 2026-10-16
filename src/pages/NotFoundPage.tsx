import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--canvas)' }}>
      <div className="card card-pad" style={{ textAlign: 'center', maxWidth: 420 }}>
        <p className="label-sm" style={{ color: 'var(--coral)' }}>404</p>
        <h1 style={{ margin: '10px 0 8px', fontSize: 22 }}>页面不存在</h1>
        <p className="hint" style={{ marginBottom: 18 }}>
          该路径未在管理后台注册。<Link to="/observatory" style={{ color: 'var(--coral)' }}>返回系统观察</Link>
        </p>
      </div>
    </div>
  )
}
