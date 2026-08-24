import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../services/api'
import Modal from '../components/Modal.jsx'
import SafeHtml from '../components/SafeHtml.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'

export default function Home() {
  const [runTime, setRunTime] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  const [noticeContent, setNoticeContent] = useState('')
  const [noticeOpen, setNoticeOpen] = useState(false)
  const alert = useAlert()
  const { community } = usePlatform()
  const navigate = useNavigate()
  const canPublish = community.posting_enabled
  const publishDisabledReason = community.pause_reason || '管理员暂时关闭了发帖功能'

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

  useEffect(() => {
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

  const triggerPublishModal = () => {
    if (!canPublish) {
      alert.showTopRightAlert(publishDisabledReason, 'warning', '暂时无法发布')
      return
    }
    navigate('/wall')
    window.setTimeout(() => window.dispatchEvent(new Event('open-publish-modal')), 80)
  }

  return (
    <div className="home-page">
      {/* Hero Section */}
      <section className="hero-section text-center">
        <div className="hero-content">
          <h1>
            观澜中学校园墙
          </h1>

          <div className="runtime-pill mx-auto mt-6 inline-flex flex-wrap items-center justify-center gap-2 px-5 py-2">
            <i className="bi bi-clock-history" aria-hidden="true" />
            <span>本站已稳定运行</span>
            <b>{runTime.days}</b>天
            <b>{runTime.hours}</b>小时
            <b>{runTime.minutes}</b>分钟
            <b>{runTime.seconds}</b>秒
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to="/wall" className="btn btn-lg hero-cta px-7">
              <i className="bi bi-compass" />
              <span>浏览校园动态</span>
            </Link>
            <button
              type="button"
              className="btn btn-lg hero-secondary-cta px-7"
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
                <i className="bi bi-incognito text-lg" aria-hidden="true" />
                <strong>自由匿名表达</strong>
              </div>
              <span>默认匿名保护隐私，放心倾诉心声与烦恼。</span>
            </div>
            <div className="hero-bubble">
              <div className="flex items-center gap-2 font-bold text-white">
                <i className="bi bi-images text-lg" aria-hidden="true" />
                <strong>多媒体互动</strong>
              </div>
              <span>支持多图、音频和短视频，分享丰富校园瞬间。</span>
            </div>
            <div className="hero-bubble">
              <div className="flex items-center gap-2 font-bold text-white">
                <i className="bi bi-chat-heart text-lg" aria-hidden="true" />
                <strong>同学互助社区</strong>
              </div>
              <span>失物招领、学习交流、提问解答一触即达。</span>
            </div>
          </div>
        </div>
      </section>

      <nav className="home-entry-grid" aria-label="校园特色入口">
        <Link className="card home-entry-card confession-entry-card" to="/confessions">
          <span className="home-entry-icon"><i className="bi bi-heart-fill" /></span>
          <span><b>表白墙</b><small>一颗为青春点亮的粉色粒子爱心</small></span>
          <i className="bi bi-chevron-right" aria-hidden="true" />
        </Link>
        <Link className="card home-entry-card" to="/lost-found">
          <span className="home-entry-icon"><i className="bi bi-search" /></span>
          <span><b>失物招领</b><small>发布寻物或招领启事，让物品更快回家</small></span>
          <i className="bi bi-chevron-right" aria-hidden="true" />
        </Link>
      </nav>

      {/* About Section */}
      <section className="about-tile text-center relative overflow-hidden">
        <div className="mx-auto max-w-2xl space-y-3.5">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary-color)] text-2xl mx-auto">
            <i className="bi bi-heart-fill" />
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">关于本站</h2>
          <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
            龙华区观澜中学校园墙由学生自主搭建与维护，旨在为师生提供一个平等、自由、温馨的交流互动平台。
            欢迎大家提出宝贵建议，共同建设美好的校园社区！
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <a
              className="btn btn-sm btn-outline"
              href="https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan"
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
        title="观澜中学校园墙公告"
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
