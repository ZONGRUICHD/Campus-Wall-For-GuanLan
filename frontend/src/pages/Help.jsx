import { Link } from 'react-router-dom'

export default function Help() {
  return (
    <div className="help-page mx-auto max-w-4xl space-y-8">
      {/* Header Banner */}
      <section className="hero-section hero-section-compact text-center">
        <div className="hero-content space-y-3">
          <span className="page-kicker hero-kicker">
            <i className="bi bi-life-preserver" />
            <span>Support & Helpdesk</span>
          </span>
          <h1>帮助与服务反馈</h1>
          <p className="hero-subtitle max-w-lg mx-auto">
            遇到技术故障、使用疑问或有平台改进建议？观澜中学校园墙管理团队会认真跟进。
          </p>
        </div>
      </section>

      {/* Options Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        <Link className="card support-card p-8 flex flex-col justify-between space-y-4 group" to="/help/form">
          <div className="space-y-4">
            <div className="support-icon">
              <i className="bi bi-chat-left-heart-fill" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">提交反馈与建议</h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                向管理员提交功能建议、网站 Bug、账号解封或其它求助支持。
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-[var(--primary-color)] flex items-center gap-1">
            <span>前往填写表单</span>
            <i className="bi bi-arrow-right" />
          </span>
        </Link>

        <Link className="card support-card p-8 flex flex-col justify-between space-y-4 group" to="/wall">
          <div className="space-y-4">
            <div className="support-icon">
              <i className="bi bi-shield-exclamation text-2xl" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">举报违规内容</h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                发现人身攻击、违规广告或不良信息？可进入对应留言详情页一键举报。
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-[var(--primary-color)] flex items-center gap-1">
            <span>前往校园墙</span>
            <i className="bi bi-arrow-right" />
          </span>
        </Link>

        <Link className="card support-card p-8 flex flex-col justify-between space-y-4 group" to="/rules">
          <div className="space-y-4">
            <div className="support-icon">
              <i className="bi bi-shield-check" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">社区公约</h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                查看当前交流准则、互动开放状态以及校园社区内容规范。
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-[var(--primary-color)] flex items-center gap-1">
            <span>查看社区规则</span>
            <i className="bi bi-arrow-right" />
          </span>
        </Link>
      </div>

      {/* Tip Strip */}
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5 text-xs text-[var(--text-secondary)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-color)] shrink-0 text-base">
          <i className="bi bi-info-circle-fill" />
        </div>
        <span>
          温馨提示：描述越详尽、信息越具体（例如附带复现步骤或截图），管理员越能迅速定位问题并高效处理。
        </span>
      </div>
    </div>
  )
}
