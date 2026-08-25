import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../services/api'
import Modal from '../components/Modal.jsx'
import SafeHtml from '../components/SafeHtml.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'

const emptyRunTime = Object.freeze({ days: 0, hours: 0, minutes: 0, seconds: 0 })

const splitDuration = (milliseconds) => {
  const duration = Math.max(0, milliseconds)
  return {
    days: Math.floor(duration / 86400000),
    hours: Math.floor((duration % 86400000) / 3600000),
    minutes: Math.floor((duration % 3600000) / 60000),
    seconds: Math.floor((duration % 60000) / 1000)
  }
}

export default function Home() {
  const [runTime, setRunTime] = useState(emptyRunTime)
  const [noticeContent, setNoticeContent] = useState('')
  const [noticeOpen, setNoticeOpen] = useState(false)
  const alert = useAlert()
  const { community } = usePlatform()
  const navigate = useNavigate()
  const canPublish = community.posting_enabled
  const publishDisabledReason = community.pause_reason || '管理员暂时关闭了发帖功能'

  useEffect(() => {
    const serverTimestamp = Date.parse(community.server_time || '')
    const launchTimestamp = Date.parse(community.site_launched_at || '')
    const clockOffset = Number.isFinite(serverTimestamp) ? serverTimestamp - Date.now() : 0
    const update = () => {
      const correctedNow = Date.now() + clockOffset
      setRunTime(Number.isFinite(launchTimestamp)
        ? splitDuration(correctedNow - launchTimestamp)
        : emptyRunTime)
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [community.server_time, community.site_launched_at])

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
    navigate('/wall', { state: { openPublish: true } })
  }

  return (
    <div className="home-page swift-home-page">
      <header className="swift-home-header">
        <span className="swift-overline">龙华区观澜中学</span>
        <h1 className="swift-large-title">校园墙</h1>
        <p className="swift-page-subtitle">记录校园日常，也让每一次表达都被温柔回应。</p>
      </header>

      <section className="swift-welcome-card" aria-labelledby="home-welcome-title">
        <div className="swift-welcome-main">
          <span className="swift-welcome-symbol" aria-hidden="true">
            <i className="bi bi-chat-heart-fill" />
          </span>
          <div className="swift-welcome-copy">
            <span className="swift-section-label">今天想分享什么？</span>
            <h2 id="home-welcome-title">欢迎回到观澜中学校园墙</h2>
            <p>自由匿名表达、分享多媒体校园瞬间，或向同学发起求助。</p>
          </div>
        </div>

        <div
          className="swift-runtime"
          aria-label={`本站已上线 ${runTime.days} 天 ${runTime.hours} 小时 ${runTime.minutes} 分钟 ${runTime.seconds} 秒`}
          title="自 2026 年 8 月 25 日 01:48:50（北京时间）首次公开访问起计算"
        >
          <span className="swift-status-dot" aria-hidden="true" />
          <span>本站已上线</span>
          <strong>{runTime.days} 天 {runTime.hours} 小时 {runTime.minutes} 分钟 {runTime.seconds} 秒</strong>
        </div>

        <div className="swift-welcome-actions">
          <Link to="/wall" className="btn btn-primary">
            <i className="bi bi-chat-square-dots" aria-hidden="true" />
            <span>浏览校园动态</span>
          </Link>
          <button
            type="button"
            className="btn btn-outline"
            onClick={triggerPublishModal}
            disabled={!canPublish}
            title={canPublish ? '快速发帖' : publishDisabledReason}
          >
            <i className="bi bi-pencil-square" aria-hidden="true" />
            <span>发布动态</span>
          </button>
        </div>
      </section>

      <section className="swift-home-section" aria-labelledby="campus-services-title">
        <div className="swift-section-heading">
          <div>
            <span className="swift-section-label">校园服务</span>
            <h2 id="campus-services-title">常用入口</h2>
          </div>
          <span>快速到达你关心的内容</span>
        </div>

        <nav className="swift-inset-group" aria-label="校园功能入口">
          <Link className="swift-list-row confession-entry-card" to="/confessions">
            <span className="swift-list-icon swift-list-icon-pink" aria-hidden="true"><i className="bi bi-heart-fill" /></span>
            <span className="swift-list-copy"><b>表白墙</b><small>查看同学们留下的青春便签</small></span>
            <i className="bi bi-chevron-right swift-list-chevron" aria-hidden="true" />
          </Link>
          <Link className="swift-list-row" to="/lost-found">
            <span className="swift-list-icon swift-list-icon-blue" aria-hidden="true"><i className="bi bi-search" /></span>
            <span className="swift-list-copy"><b>失物招领</b><small>发布寻物或招领启事，让物品更快回家</small></span>
            <i className="bi bi-chevron-right swift-list-chevron" aria-hidden="true" />
          </Link>
          <Link className="swift-list-row" to="/p">
            <span className="swift-list-icon swift-list-icon-indigo" aria-hidden="true"><i className="bi bi-hash" /></span>
            <span className="swift-list-copy"><b>话题分类</b><small>按兴趣浏览日常、学习、互助和树洞</small></span>
            <i className="bi bi-chevron-right swift-list-chevron" aria-hidden="true" />
          </Link>
          <Link className="swift-list-row" to="/help">
            <span className="swift-list-icon swift-list-icon-green" aria-hidden="true"><i className="bi bi-life-preserver" /></span>
            <span className="swift-list-copy"><b>帮助与反馈</b><small>提交建议、网站问题或违规内容线索</small></span>
            <i className="bi bi-chevron-right swift-list-chevron" aria-hidden="true" />
          </Link>
        </nav>
      </section>

      <section className="swift-home-section swift-about-section" aria-labelledby="about-campus-wall-title">
        <div className="swift-section-heading">
          <div>
            <span className="swift-section-label">关于</span>
            <h2 id="about-campus-wall-title">由学生为校园搭建</h2>
          </div>
        </div>
        <div className="swift-about-card">
          <p>
            龙华区观澜中学校园墙由学生自主搭建与维护，旨在为师生提供一个平等、自由、温馨的交流互动平台。
            欢迎大家提出宝贵建议，共同建设美好的校园社区。
          </p>
          <nav className="swift-about-links" aria-label="关于本站链接">
            <a href="https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan" target="_blank" rel="noreferrer">
              <i className="bi bi-github" aria-hidden="true" /><span>开源代码仓库</span><i className="bi bi-arrow-up-right" aria-hidden="true" />
            </a>
            <Link to="/rules"><i className="bi bi-file-earmark-ruled" aria-hidden="true" /><span>社区公约</span><i className="bi bi-chevron-right" aria-hidden="true" /></Link>
            <Link to="/help"><i className="bi bi-envelope" aria-hidden="true" /><span>联系站长</span><i className="bi bi-chevron-right" aria-hidden="true" /></Link>
          </nav>
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
