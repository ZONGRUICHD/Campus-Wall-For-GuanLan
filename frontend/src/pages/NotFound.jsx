import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="page-center text-center py-16">
      <div className="card max-w-lg mx-auto p-10 space-y-6 shadow-xl relative overflow-hidden">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-color)] text-5xl mx-auto shadow-inner">
          <i className="bi bi-compass" />
        </div>

        <div className="space-y-2">
          <span className="page-kicker text-xs">
            <i className="bi bi-exclamation-triangle-fill text-amber-500 mr-1" />
            <span>Page Not Found</span>
          </span>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight text-[var(--text-primary)]">
            404
          </h1>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            抱歉，你访问的页面似乎迷路了，可能已被移动或链接输入有误。
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link to="/" className="btn btn-primary px-6">
            <i className="bi bi-house-door" />
            <span>返回首页</span>
          </Link>
          <Link to="/wall" className="btn btn-outline px-6">
            <i className="bi bi-chat-square-heart" />
            <span>逛逛校园墙</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
