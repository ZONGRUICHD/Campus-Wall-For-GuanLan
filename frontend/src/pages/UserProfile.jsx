import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../services/api'
import MessageCard from '../components/MessageCard.jsx'
import Skeleton from '../components/Skeleton.jsx'
import { genderText, getAvatarUrl, getGenderIcon, handleAvatarError, publicUserFromProfile } from '../utils/user'
import { useAlert } from '../contexts/AlertContext.jsx'

export default function UserProfile() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [messages, setMessages] = useState([])
  const alert = useAlert()

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.allSettled([api.getUserProfile(id), api.getUserMessages(id)])
      .then(([profileResult, messagesResult]) => {
        if (!alive) return
        if (profileResult.status === 'fulfilled' && profileResult.value.data?.success) {
          setProfile(publicUserFromProfile(profileResult.value.data.user))
        } else {
          setProfile(null)
        }
        setMessages(messagesResult.status === 'fulfilled' ? (messagesResult.value.data?.messages || []) : [])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id])

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      alert.showTopRightAlert('个人主页链接已复制到剪贴板', 'success', '分享成功')
    } catch {
      alert.showTopRightAlert(window.location.href, 'info', '主页链接')
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="card p-8">
          <Skeleton type="avatar-large" />
        </section>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="page-center">
        <div className="empty-state-card max-w-xl">
          <i className="bi bi-people" />
          <p className="mt-4 text-base font-bold text-[var(--text-primary)]">用户不存在或资料不可用</p>
          <Link to="/wall" className="btn btn-primary mt-4">返回校园墙</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Cover Header */}
      <section className="card overflow-hidden">
        <div className="profile-cover" />
        <div className="profile-summary -mt-14 flex flex-col md:flex-row items-start md:items-end justify-between gap-6 p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-5">
            <div className="relative shrink-0">
              <img
                className="profile-avatar h-28 w-28 md:h-32 md:w-32 rounded-full object-cover shadow-xl"
                src={getAvatarUrl(profile.id, profile.avatar_url)}
                alt={profile.nickname}
                onError={handleAvatarError}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="page-kicker text-xs">
                  <i className="bi bi-person-fill" />
                  <span>公开主页</span>
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-[var(--text-primary)]">
                {profile.nickname}
              </h1>
              {profile.bio ? <p className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">{profile.bio}</p> : null}
              <div className="profile-meta-grid">
                <span>
                  <i className={`${getGenderIcon(profile.gender)} text-amber-500`} />
                  {genderText(profile.gender)}
                </span>
                <span>
                  <i className="bi bi-chat-quote-fill text-[var(--primary-color)]" />
                  {messages.length} 条公开分享
                </span>
                {profile.created_at ? (
                  <span>
                    <i className="bi bi-clock text-[var(--primary-color)]" />
                    {dayjs(profile.created_at).format('YYYY年M月')}加入
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <button className="btn btn-outline" type="button" onClick={share}>
            <i className="bi bi-share" />
            <span>分享主页</span>
          </button>
        </div>
      </section>

      {/* Stream Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="page-kicker text-xs">
            <i className="bi bi-chat-dots" />
            <span>Timeline</span>
          </span>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">该同学的公开留言</h2>
        </div>
        <span className="text-xs text-[var(--text-muted)]">仅展示非匿名发表的内容</span>
      </div>

      {!messages.length ? (
        <div className="empty-state-card">
          <i className="bi bi-chat-square-dots" />
          <p className="mt-4 text-base font-bold text-[var(--text-primary)]">还没有公开留言</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">该同学可能习惯匿名发布内容哦 ~</p>
        </div>
      ) : null}

      <div className="space-y-5">
        {messages.map((message) => <MessageCard key={message.id} message={message} />)}
      </div>
    </div>
  )
}
