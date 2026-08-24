import { Link, useSearchParams } from 'react-router-dom'

export default function HelpSuccess() {
  const [searchParams] = useSearchParams()
  const isReport = searchParams.get('type') === 'report'
  const itemName = isReport ? '举报' : '反馈'

  return (
    <div className="page-center text-center py-12">
      <section className="card max-w-lg mx-auto p-8 md:p-10 space-y-6 shadow-xl relative overflow-hidden">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 text-4xl mx-auto shadow-inner">
          <i className="bi bi-check-circle-fill" />
        </div>

        <div className="space-y-2">
          <span className="page-kicker status-success">
            <i className="bi bi-check2-all mr-1" />
            <span>已成功录入系统</span>
          </span>
          <h1 className="text-2xl md:text-3xl font-black text-[var(--text-primary)]">
            {itemName}提交成功
          </h1>
          <p className="text-xs md:text-sm text-[var(--text-secondary)] max-w-sm mx-auto leading-relaxed">
            {isReport
              ? '举报已进入核查队列。管理员会依据社区公约完成核实与处置。'
              : '非常感谢你的反馈与配合！相关请求已进入处理队列，管理员将会在第一时间审阅与处理。'}
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--card-secondary-bg)] py-2.5 px-4 rounded-xl border border-[var(--border-color)]">
          <i className="bi bi-clock-history text-amber-500" />
          <span>通常在 1-2 个工作日内核实完毕</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link className="btn btn-primary px-6" to="/">
            <i className="bi bi-house-door" />
            <span>返回首页</span>
          </Link>
          <Link className="btn btn-outline px-6" to="/wall">
            <i className="bi bi-chat-square-heart" />
            <span>逛逛校园墙</span>
          </Link>
        </div>
      </section>
    </div>
  )
}
