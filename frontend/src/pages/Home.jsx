import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../services/api'
import Modal from '../components/Modal.jsx'
import NoticeCard from '../components/NoticeCard.jsx'
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

const noticeSeenKey = (notice) => {
  if (!notice) return ''
  const identity = notice.id || notice.timestamp || 'latest'
  const revision = Math.max(Number(notice.reminder_revision) || 1, 1)
  return `campuswall:notice:seen:${identity}:${revision}`
}

const isAttentionNotice = (notice) => ['important', 'urgent'].includes(notice?.priority)

const serviceEntries = Object.freeze([
  { id: 'confessions', to: '/confessions', label: '表白墙', icon: 'bi-heart-fill', tone: 'pink', className: 'confession-entry-card' },
  { id: 'lost-found', to: '/lost-found', label: '失物招领', icon: 'bi-search', tone: 'blue' },
  { id: 'topics', to: '/p', label: '话题分类', icon: 'bi-hash', tone: 'indigo' },
  { id: 'help', to: '/help', label: '帮助与反馈', icon: 'bi-life-preserver', tone: 'green' }
])

export default function Home() {
  const [runTime, setRunTime] = useState(emptyRunTime)
  const [notices, setNotices] = useState([])
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [noticeReadKeys, setNoticeReadKeys] = useState([])
  const alert = useAlert()
  const { community, enabledModuleIds } = usePlatform()
  const navigate = useNavigate()
  const wallEnabled = enabledModuleIds.has('wall')
  const canPublish = wallEnabled && community.posting_enabled
  const publishDisabledReason = wallEnabled
    ? (community.pause_reason || '管理员暂时关闭了发帖功能')
    : '校园动态板块当前未启用'
  const visibleServiceEntries = serviceEntries.filter((entry) => enabledModuleIds.has(entry.id))

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
        const items = (Array.isArray(response.data.content) ? response.data.content : [])
          .map((item) => ({
            ...item,
            title: String(item?.title || '').trim(),
            summary: String(item?.summary || '').trim(),
            content: String(item?.content || item?.text || '').trim(),
            priority: ['important', 'urgent'].includes(item?.priority) ? item.priority : 'normal',
            reminder_revision: Math.max(Number(item?.reminder_revision) || 1, 1)
          }))
          .filter((item) => item.content)
        setNotices(items)
        const attentionKeys = items.filter(isAttentionNotice).map(noticeSeenKey).filter(Boolean)
        if (attentionKeys.length) {
          let unreadKeys = attentionKeys
          try {
            unreadKeys = attentionKeys.filter((key) => !window.localStorage.getItem(key))
          } catch {
            // If storage is unavailable, showing the important notice is safer
            // than silently treating it as read.
          }
          if (unreadKeys.length) {
            setNoticeReadKeys(unreadKeys)
            setNoticeOpen(true)
          }
        }
      }
    }).catch(() => {})
  }, [])

  const latestNotice = notices[0] || null

  const openNotices = () => {
    setNoticeReadKeys(notices.filter(isAttentionNotice).map(noticeSeenKey).filter(Boolean))
    setNoticeOpen(true)
  }

  const closeNotices = () => {
    if (noticeReadKeys.length) {
      try {
        noticeReadKeys.forEach((key) => window.localStorage.setItem(key, 'seen'))
      } catch {
        // The modal can still close when persistent storage is unavailable.
      }
    }
    setNoticeReadKeys([])
    setNoticeOpen(false)
  }

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
      </header>

      {latestNotice ? (
        <section className="swift-home-section swift-announcement-section" aria-labelledby="campus-announcement-title">
          <div className="swift-section-heading">
            <div>
              <span className="swift-section-label">重要信息</span>
              <h2 id="campus-announcement-title">校园公告</h2>
            </div>
            <span>{notices.length} 条正在展示</span>
          </div>
          <NoticeCard notice={latestNotice} compact onClick={openNotices} />
        </section>
      ) : null}

      <section className="swift-welcome-card" aria-labelledby="home-welcome-title">
        <div className="swift-welcome-main">
          <span className="swift-welcome-symbol" aria-hidden="true">
            <i className="bi bi-chat-heart-fill" />
          </span>
          <div className="swift-welcome-copy">
            <span className="swift-section-label">今天想分享什么？</span>
            <h2 id="home-welcome-title">欢迎回到观澜中学校园墙</h2>
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

        {wallEnabled ? (
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
        ) : null}
      </section>

      <section className="swift-home-section" aria-labelledby="campus-services-title">
        <div className="swift-section-heading">
          <div>
            <span className="swift-section-label">校园服务</span>
            <h2 id="campus-services-title">常用入口</h2>
          </div>
        </div>

        <nav className="swift-inset-group" aria-label="校园功能入口">
          {visibleServiceEntries.map((entry) => (
            <Link className={`swift-list-row ${entry.className || ''}`.trim()} to={entry.to} key={entry.id}>
              <span className={`swift-list-icon swift-list-icon-${entry.tone}`} aria-hidden="true"><i className={`bi ${entry.icon}`} /></span>
              <span className="swift-list-copy"><b>{entry.label}</b></span>
              <i className="bi bi-chevron-right swift-list-chevron" aria-hidden="true" />
            </Link>
          ))}
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
            {enabledModuleIds.has('help') ? (
              <>
                <Link to="/rules"><i className="bi bi-file-earmark-ruled" aria-hidden="true" /><span>社区公约</span><i className="bi bi-chevron-right" aria-hidden="true" /></Link>
                <Link to="/help"><i className="bi bi-envelope" aria-hidden="true" /><span>联系站长</span><i className="bi bi-chevron-right" aria-hidden="true" /></Link>
              </>
            ) : null}
          </nav>
        </div>
      </section>

      {/* System Announcement Modal */}
      <Modal
        visible={noticeOpen}
        title="观澜中学校园墙公告"
        onClose={closeNotices}
        footer={
          <button className="btn btn-primary" type="button" onClick={closeNotices}>
            我知道了
          </button>
        }
      >
        <div className="swift-announcement-list">
          {notices.map((notice, index) => <NoticeCard notice={notice} key={notice.id || `${notice.timestamp}-${index}`} />)}
        </div>
      </Modal>
    </div>
  )
}
