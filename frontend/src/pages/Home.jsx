import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import api from '../services/api'
import Modal from '../components/Modal.jsx'
import SafeHtml from '../components/SafeHtml.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const sampleTags = ['日常', '树洞', '表白', '学习', '寻物', '吐槽']

export default function Home() {
  const [runTime, setRunTime] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  const [hotMessages, setHotMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [quickText, setQuickText] = useState('')
  const [quickTag, setQuickTag] = useState('')
  const [noticeContent, setNoticeContent] = useState('')
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const alert = useAlert()
  const { user } = useUser()
  const { community } = usePlatform()
  const navigate = useNavigate()
  const canPublish = !user?.is_muted
    && community.posting_enabled
    && (Boolean(user) || community.guest_posting_enabled)
  const publishDisabledReason = user?.is_muted
    ? (user.mute_reason ? `账号已被禁言：${user.mute_reason}` : '账号已被禁言，暂时不能发帖')
    : (!community.posting_enabled
        ? (community.pause_reason || '管理员暂时关闭了发帖功能')
        : '当前仅登录学生可以发帖')

  const startDate = useMemo(() => new Date(2025, 7, 21, 13, 37, 11), [])

  useEffect(() => {
    const update = () => {
      const diff = Date.now() - startDate.getTime()
      setRunTime({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000)
      })
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [startDate])

  const loadHotMessages = async () => {
    setLoading(true)
    try {
      const response = await api.getHotMessages()
      if (response.data?.success) setHotMessages(response.data.messages || [])
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载热门失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHotMessages()
    api.getNotice().then((response) => {
      if (response.data?.success) {
        const content = Array.isArray(response.data.content)
          ? response.data.content.map((item) => item.content || item.text || '').filter(Boolean).join('<hr />')
          : response.data.content
        setNoticeContent(content || '')
        const month = `${new Date().getFullYear()}-${new Date().getMonth() + 1}`
        if (content && !localStorage.getItem(`hasVisitedWall${month}`)) {
          setNoticeOpen(true)
          localStorage.setItem(`hasVisitedWall${month}`, 'true')
        }
      }
    }).catch(() => {})
  }, [])

  const submitQuick = async (event) => {
    event.preventDefault()
    if (!canPublish) {
      alert.showTopRightAlert(publishDisabledReason, 'warning', '暂时无法发布')
      return
    }
    if (!quickText.trim()) {
      alert.showTopRightAlert('请输入留言内容', 'warning', '提示')
      return
    }
    setSubmitting(true)
    try {
      const response = await api.submitMessage({ text: quickText.trim(), tags: quickTag, filenames: [] })
      setQuickText('')
      setQuickTag('')
      const pendingReview = response.data?.moderation_status === 'pending'
      alert.showTopRightAlert(
        pendingReview ? '留言已提交审核，可在个人中心查看进度' : '发布成功！已同步至校园墙',
        'success',
        pendingReview ? '等待审核' : '成功'
      )
      loadHotMessages()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  const triggerPublishModal = () => {
    if (!canPublish) {
      alert.showTopRightAlert(publishDisabledReason, 'warning', '暂时无法发布')
      return
    }
    navigate('/wall')
    window.setTimeout(() => window.dispatchEvent(new Event('open-publish-modal')), 80)
  }

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <section className="hero-section px-6 py-14 text-center md:px-12 md:py-18">
        <div className="hero-content">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold backdrop-blur-md bg-white/15 border border-white/20 shadow-inner">
            <i className="bi bi-stars text-amber-300" />
            <span>校园社区 · 学生交流平台</span>
          </div>

          <h1 className="mt-5 text-3xl font-black tracking-tight text-white md:text-5xl drop-shadow-sm">
            校园墙
          </h1>

          <p className="hero-subtitle mx-auto mt-3 max-w-2xl text-sm md:text-base">
            记录校园日常、分享心声灵感。匿名倾诉、暖心互动，让每一次发声都有温暖回应。
          </p>

          <div className="runtime-pill mx-auto mt-6 inline-flex flex-wrap items-center justify-center gap-2 rounded-full px-5 py-2 text-xs md:text-sm">
            <i className="bi bi-clock-history text-amber-300" />
            <span>本站已稳定运行</span>
            <b>{runTime.days}</b>天
            <b>{runTime.hours}</b>小时
            <b>{runTime.minutes}</b>分钟
            <b>{runTime.seconds}</b>秒
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to="/wall" className="btn btn-lg hero-cta px-7">
              <i className="bi bi-compass" />
              <span>进入校园墙</span>
            </Link>
            <button
              type="button"
              className="btn btn-lg border border-white/30 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 px-7"
              onClick={triggerPublishModal}
              disabled={!canPublish}
              title={canPublish ? '快速发帖' : publishDisabledReason}
            >
              <i className="bi bi-pencil-square" />
              <span>快速发帖</span>
            </button>
          </div>

          <div className="hero-bubbles mt-8">
            <div className="hero-bubble">
              <div className="flex items-center gap-2 font-bold text-white">
                <i className="bi bi-incognito text-amber-300 text-lg" />
                <strong>自由匿名表达</strong>
              </div>
              <span>默认匿名保护隐私，放心倾诉心声与烦恼。</span>
            </div>
            <div className="hero-bubble">
              <div className="flex items-center gap-2 font-bold text-white">
                <i className="bi bi-images text-emerald-300 text-lg" />
                <strong>多媒体互动</strong>
              </div>
              <span>支持多图、音频和短视频，分享丰富校园瞬间。</span>
            </div>
            <div className="hero-bubble">
              <div className="flex items-center gap-2 font-bold text-white">
                <i className="bi bi-chat-heart text-rose-300 text-lg" />
                <strong>同学互助社区</strong>
              </div>
              <span>失物招领、学习交流、提问解答一触即达。</span>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section>
        <div className="section-heading mb-8 text-center">
          <span className="badge font-bold text-xs"><i className="bi bi-lightning-charge-fill text-amber-500 mr-1" />功能特色</span>
          <h2 className="section-title text-2xl md:text-3xl mt-2 font-bold text-[var(--text-primary)]">为校园交流精心打造</h2>
          <p className="mt-1.5 text-xs md:text-sm text-[var(--text-secondary)]">轻量极速、温馨友善的校园交流平台</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['bi-speedometer2', '即刻发表', '轻量极速架构，随时随地一键发布，秒速展现你的精彩想法。'],
            ['bi-heart-fill', '互动交流', '支持点赞、点踩与盖楼评论，实时倾听大家的声音与共鸣。'],
            ['bi-cloud-arrow-up', '丰富媒体', '原生支持图片画廊、音频与视频，让每一次表达都有声有色。'],
            ['bi-shield-check', '安全可靠', '全链路内容管理与防违规机制，用心守护纯粹友善的校园交流环境。']
          ].map(([icon, title, text]) => (
            <div key={title} className="card feature-card text-center p-6 space-y-3">
              <div className="feature-icon mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-xl bg-[var(--primary-light)] text-[var(--primary-color)]">
                <i className={`bi ${icon}`} />
              </div>
              <h3 className="text-base font-bold text-[var(--text-primary)]">{title}</h3>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Composer Section */}
      <section className="mx-auto max-w-3xl">
        <div className="section-heading mb-6 text-center">
          <span className="badge font-bold text-xs"><i className="bi bi-chat-left-quote text-[var(--primary-color)] mr-1" />快速发表</span>
          <h2 className="section-title text-2xl md:text-3xl mt-2 font-bold text-[var(--text-primary)]">此刻有什么想分享？</h2>
          <p className="mt-1.5 text-xs md:text-sm text-[var(--text-secondary)]">写下你的想法，一键发送至公开墙</p>
        </div>
        <form className="card composer-card p-5 md:p-6" onSubmit={submitQuick}>
          {!canPublish ? (
            <div className="info-callout status-warning mb-4">
              <i className="bi bi-info-circle-fill" />
              <span>{publishDisabledReason}</span>
              {!user && community.posting_enabled ? <Link className="ml-auto font-bold" to="/login">前往登录</Link> : null}
            </div>
          ) : null}
          <textarea
            className="field min-h-24 w-full border-0 bg-transparent focus:ring-0 p-0 text-sm md:text-base outline-none resize-none"
            value={quickText}
            onChange={(event) => setQuickText(event.target.value)}
            placeholder="此刻有什么想和大家分享的？（默认匿名发布）"
            maxLength={1000}
            disabled={!canPublish}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-color)] pt-3.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-[var(--text-muted)] mr-1">快捷标签:</span>
              {sampleTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  disabled={!canPublish}
                  onClick={() => setQuickTag(quickTag === tag ? '' : tag)}
                  className={`badge text-xs cursor-pointer ${quickTag === tag ? 'bg-[var(--primary-color)] text-white border-transparent' : ''}`}
                >
                  #{tag}
                </button>
              ))}
            </div>
            <button
              className="btn btn-sm btn-primary ml-auto px-4"
              type="submit"
              disabled={!canPublish || submitting || !quickText.trim()}
            >
              <i className="bi bi-send-fill" />
              <span>{submitting ? '发送中...' : '立即发布'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Hot Messages Section */}
      <section>
        <div className="section-heading mb-6 text-center">
          <span className="badge font-bold text-xs"><i className="bi bi-fire text-rose-500 mr-1" />热门话题</span>
          <h2 className="section-title text-2xl md:text-3xl mt-2 font-bold text-[var(--text-primary)]">大家都在聊什么</h2>
          <p className="mt-1.5 text-xs md:text-sm text-[var(--text-secondary)]">实时汇聚全校师生最关注的精彩动态</p>
        </div>

        {loading ? (
          <div className="grid gap-5 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card p-5 space-y-3">
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton h-14 w-full" />
                <div className="skeleton h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : null}

        {!loading && hotMessages.length === 0 ? (
          <div className="empty-state-card">
            <i className="bi bi-inbox" />
            <p className="mt-3 font-semibold">暂无热门留言</p>
            <p className="text-xs text-[var(--text-muted)]">快去发第一条有趣的留言吧！</p>
          </div>
        ) : null}

        <div className="grid gap-5 md:grid-cols-3">
          {hotMessages.map((message, index) => (
            <Link
              key={message.id}
              to={`/wall/message/${message.id}`}
              className="card hot-message-card p-5 flex flex-col justify-between group"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className={`badge text-xs font-bold ${index === 0 ? 'bg-rose-500 text-white border-transparent' : index === 1 ? 'bg-amber-500 text-white border-transparent' : 'bg-blue-600 text-white border-transparent'}`}>
                    <i className="bi bi-trophy-fill mr-1 text-[10px]" />TOP {index + 1}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {message.timestamp ? dayjs(message.timestamp).fromNow() : ''}
                  </span>
                </div>
                {message.pinned || message.featured || message.poll ? (
                  <div className="flex flex-wrap gap-1.5">
                    {message.pinned ? <span className="badge status-warning text-[10px]"><i className="bi bi-pin-angle" />置顶</span> : null}
                    {message.featured ? <span className="badge status-success text-[10px]"><i className="bi bi-star-fill" />精华</span> : null}
                    {message.poll ? <span className="badge text-[10px]"><i className="bi bi-ui-radios-grid" />投票</span> : null}
                  </div>
                ) : null}
                <p className="message-text line-clamp-3 text-sm text-[var(--text-primary)] leading-relaxed group-hover:text-[var(--primary-color)] transition-colors">
                  {message.text || message.poll?.question || '校园墙留言'}
                </p>
              </div>

              <div className="hot-message-meta mt-4 pt-3 border-t border-[var(--border-color)] flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  {message.anonymous !== false
                    ? '匿名同学'
                    : (message.display_name_snapshot || '同学')}
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 text-rose-500">
                    <i className="bi bi-hand-thumbs-up-fill" /> {message.likes || 0}
                  </span>
                  <span className="flex items-center gap-1 text-[var(--primary-color)]">
                    <i className="bi bi-chat-dots-fill" /> {message.comments?.length || 0}
                  </span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* About Section */}
      <section className="card p-8 md:p-10 text-center relative overflow-hidden">
        <div className="mx-auto max-w-2xl space-y-3.5">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary-color)] text-2xl mx-auto">
            <i className="bi bi-heart-fill" />
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">关于本站</h2>
          <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
            本站由学生自主搭建与维护，旨在为师生提供一个平等、自由、温馨的交流互动平台。
            欢迎大家提出宝贵建议，共同建设美好的校园社区！
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <a
              className="btn btn-sm btn-outline"
              href="https://github.com/Gavin-LHX/campuswall-react"
              target="_blank"
              rel="noreferrer"
            >
              <i className="bi bi-github" />
              <span>开源代码仓库</span>
            </a>
            <Link to="/rules" className="btn btn-sm btn-outline">
              <i className="bi bi-file-earmark-ruled" />
              <span>社区公约</span>
            </Link>
            <Link to="/help" className="btn btn-sm btn-outline">
              <i className="bi bi-envelope" />
              <span>联系站长 / 帮助</span>
            </Link>
          </div>
        </div>
      </section>

      {/* System Announcement Modal */}
      <Modal
        visible={noticeOpen}
        title="校园墙公告"
        onClose={() => setNoticeOpen(false)}
        footer={
          <button className="btn btn-primary" onClick={() => setNoticeOpen(false)}>
            我知道了
          </button>
        }
      >
        <SafeHtml html={noticeContent || '暂无公告'} />
      </Modal>
    </div>
  )
}
