import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import { genderText } from '../utils/user'

export default function Me() {
  const { user, loading, logout, refreshMe, setUser, notificationUnread } = useUser()
  const [nickname, setNickname] = useState('')
  const [gender, setGender] = useState(0)
  const [bio, setBio] = useState('')
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarStamp, setAvatarStamp] = useState(Date.now())
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const navigate = useNavigate()
  const alert = useAlert()

  useEffect(() => {
    if (user) {
      setNickname(user.nickname || '')
      setGender(user.gender || 0)
      setBio(user.bio || '')
    }
  }, [user])

  if (loading) {
    return (
      <div className="page-center">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  const saveProfile = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      const response = await api.userUpdateProfile({ nickname, gender, bio })
      if (response.data?.success) {
        setUser(response.data.user)
        alert.showTopRightAlert('个人资料修改已保存', 'success', '保存成功')
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const uploadAvatar = async () => {
    if (!avatarFile) {
      alert.showTopRightAlert('请选择需要上传的头像文件', 'warning', '提示')
      return
    }
    setUploading(true)
    try {
      const response = await api.userUploadAvatar(avatarFile)
      if (response.data?.success) {
        setUser(response.data.user)
        setAvatarStamp(Date.now())
        setAvatarFile(null)
        alert.showTopRightAlert('新头像上传成功！', 'success', '成功')
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const changePassword = async (event) => {
    event.preventDefault()
    if (newPassword.length < 8) {
      alert.showTopRightAlert('新密码至少需要 8 个字符', 'warning', '密码过短')
      return
    }
    if (newPassword !== confirmPassword) {
      alert.showTopRightAlert('两次输入的新密码不一致', 'warning', '请检查输入')
      return
    }
    setPasswordSaving(true)
    try {
      const response = await api.userChangePassword({
        current_password: currentPassword,
        new_password: newPassword
      })
      if (response.data?.success) {
        setUser(response.data.user)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        alert.showTopRightAlert('密码已修改，其他设备需要重新登录', 'success', '修改成功')
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '密码修改失败')
    } finally {
      setPasswordSaving(false)
    }
  }

  const doLogout = async () => {
    await logout()
    alert.showTopRightAlert('已退出登录', 'info', '提示')
    navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Profile Banner */}
      <section className="card overflow-hidden">
        <div className="profile-cover" />
        <div className="profile-summary -mt-14 flex flex-col md:flex-row items-start md:items-end justify-between gap-6 p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-5">
            <div className="relative shrink-0">
              <img
                className="profile-avatar h-28 w-28 md:h-32 md:md:w-32 rounded-full object-cover shadow-lg"
                src={`${user.avatar_url}?v=${avatarStamp}`}
                alt={user.nickname}
              />
              <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white text-xs border-2 border-white shadow">
                <i className="bi bi-check-lg" />
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="page-kicker text-xs">
                  <i className="bi bi-person-fill" />
                  <span>已登录认证学生</span>
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-[var(--text-primary)]">
                {user.nickname || '未设置昵称'}
              </h1>
              <div className="profile-meta-grid">
                <span>
                  <i className="bi bi-person-badge text-[var(--primary-color)]" />
                  <span>学号：{user.username}</span>
                </span>
                <span>
                  <i className="bi bi-gender-ambiguous text-amber-500" />
                  <span>性别：{genderText(user.gender)}</span>
                </span>
                <Link to={`/user/${user.id}`} className="text-xs font-bold text-[var(--primary-color)] hover:underline flex items-center gap-1 self-center ml-1">
                  <span>查看我的公开主页</span>
                  <i className="bi bi-arrow-right-short" />
                </Link>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 self-end md:self-auto">
            <Link className="btn btn-outline" to="/me/posts">
              <i className="bi bi-journal-text" />
              <span>我的发布</span>
            </Link>
            <Link className="btn btn-outline" to="/me/comments">
              <i className="bi bi-chat-left-text-fill" />
              <span>我的评论</span>
            </Link>
            <Link className="btn btn-primary" to="/me/favorites">
              <i className="bi bi-heart-fill" />
              <span>我的收藏</span>
            </Link>
            <Link className="btn btn-outline relative" to="/me/notifications">
              <i className="bi bi-bell" />
              <span>消息通知</span>
              {notificationUnread ? <span className="badge">{notificationUnread > 99 ? '99+' : notificationUnread}</span> : null}
            </Link>
            <button className="btn btn-outline" type="button" onClick={doLogout}>
              <i className="bi bi-box-arrow-right" />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </section>

      {/* Mute Warning */}
      {user.is_muted ? (
        <section className="status-warning rounded-2xl p-4 flex items-start gap-3">
          <i className="bi bi-exclamation-octagon-fill text-xl shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <b className="text-sm">账号当前处于禁言状态</b>
            <p className="text-xs opacity-90">
              到期时间：{user.muted_until || '未设置'}
              {user.mute_reason ? ` · 原因：${user.mute_reason}` : ''}
            </p>
          </div>
        </section>
      ) : null}

      {/* Main Settings Grid */}
      <section className="grid gap-6 lg:grid-cols-[1.2fr_380px]">
        {/* Profile Info Form */}
        <form className="card p-6 md:p-8 space-y-5" onSubmit={saveProfile}>
          <div className="space-y-1">
            <span className="page-kicker text-xs">
              <i className="bi bi-sliders" />
              <span>Settings</span>
            </span>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">个人资料设置</h2>
            <p className="text-xs text-[var(--text-muted)]">更新你的公开展示昵称、个人简介与性别属性</p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">展示昵称</span>
            <input
              className="field w-full"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              maxLength={40}
              placeholder="公开页面展示的个性昵称"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="flex items-center justify-between gap-3 text-xs font-bold text-[var(--text-secondary)]">
              <span>个人简介</span>
              <span className="font-normal text-[var(--text-muted)]">{bio.length}/200</span>
            </span>
            <textarea
              className="field min-h-28 w-full resize-y"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              maxLength={200}
              placeholder="介绍一下自己，公开主页会展示这段内容"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">性别</span>
            <select
              className="field w-full"
              value={gender}
              onChange={(event) => setGender(Number(event.target.value))}
            >
              <option value={0}>保密 / 未设置</option>
              <option value={1}>男生 👦</option>
              <option value={2}>女生 👧</option>
            </select>
          </label>

          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-secondary-bg)] p-4 text-xs text-[var(--text-secondary)] leading-relaxed">
            <i className="bi bi-info-circle-fill text-[var(--primary-color)] mr-1.5" />
            学号为唯一身份凭证，不可自行修改。发帖时可选择匿名或使用上述昵称，不公开真实姓名。
          </div>

          <button className="btn btn-primary px-6" type="submit" disabled={saving}>
            <i className="bi bi-check-circle" />
            <span>{saving ? '正在保存...' : '保存资料'}</span>
          </button>
        </form>

        {/* Avatar Upload Card */}
        <section className="card p-6 md:p-8 space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="space-y-1">
              <span className="page-kicker text-xs">
                <i className="bi bi-image" />
                <span>Avatar</span>
              </span>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">头像管理</h2>
              <p className="text-xs text-[var(--text-muted)]">支持 png, jpg, gif 或 webp 格式</p>
            </div>

            <label className="upload-dropzone flex min-h-36 cursor-pointer flex-col items-center justify-center p-4 text-center">
              <i className="bi bi-cloud-arrow-up-fill text-3xl text-[var(--primary-color)] mb-2" />
              <p className="text-xs font-bold text-[var(--text-primary)]">
                {avatarFile ? avatarFile.name : '点击选择新头像图片'}
              </p>
              <p className="text-[0.7rem] text-[var(--text-muted)] mt-1">推荐使用正方形尺寸图片</p>
              <input
                hidden
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(event) => setAvatarFile(event.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="space-y-2.5">
            <button
              className="btn btn-primary w-full justify-center"
              type="button"
              disabled={uploading || !avatarFile}
              onClick={uploadAvatar}
            >
              <i className="bi bi-cloud-upload" />
              <span>{uploading ? '上传中...' : '确认更换头像'}</span>
            </button>
            <button
              className="btn btn-sm btn-outline w-full justify-center"
              type="button"
              onClick={refreshMe}
            >
              <i className="bi bi-arrow-clockwise" />
              <span>刷新登录状态</span>
            </button>
          </div>
        </section>
      </section>

      <form className="card p-6 md:p-8 space-y-5" onSubmit={changePassword}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <span className="page-kicker text-xs">
              <i className="bi bi-shield-lock" />
              <span>Security</span>
            </span>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">修改登录密码</h2>
            <p className="text-xs text-[var(--text-muted)]">修改后，其他设备上的旧登录状态会自动失效。</p>
          </div>
          <span className="badge">
            <i className="bi bi-key" />
            最少 8 个字符
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">当前密码</span>
            <input
              className="field w-full"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="请输入当前密码"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">新密码</span>
            <input
              className="field w-full"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              placeholder="输入新的登录密码"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">确认新密码</span>
            <input
              className="field w-full"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              placeholder="再次输入新密码"
              required
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button className="btn btn-primary px-6" type="submit" disabled={passwordSaving}>
            <i className="bi bi-shield-check" />
            <span>{passwordSaving ? '正在修改...' : '确认修改密码'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
