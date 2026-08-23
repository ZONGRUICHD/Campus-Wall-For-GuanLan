"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import { CloseIcon } from "@/components/icons";
import {
  ApiError,
  type CampusVerification,
  type DeviceSession,
  fetchCampusVerification,
  fetchDeviceSessions,
  fetchMyProfile,
  revokeDeviceSession,
  submitCampusVerification,
  updateMyPrivacy,
  updateMyProfile,
  type UserProfile,
} from "@/lib/api";

type AccountTab = "profile" | "privacy" | "sessions" | "verification";

type AccountDialogProps = {
  onClose: () => void;
  onProfileUpdated: (profile: UserProfile) => void;
};

function readableError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "账号服务暂时不可用，请稍后重试。";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AccountDialog({
  onClose,
  onProfileUpdated,
}: AccountDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<AccountTab>("profile");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [verification, setVerification] =
    useState<CampusVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    void Promise.all([
      fetchMyProfile(),
      fetchDeviceSessions(),
      fetchCampusVerification(),
    ])
      .then(([nextProfile, nextSessions, nextVerification]) => {
        setProfile(nextProfile);
        setSessions(nextSessions);
        setVerification(nextVerification);
      })
      .catch((loadError) => setError(readableError(loadError)))
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const nextProfile = await updateMyProfile({
        display_name: String(form.get("display_name") ?? ""),
        bio: String(form.get("bio") ?? "") || null,
        avatar_url: String(form.get("avatar_url") ?? "") || null,
      });
      setProfile(nextProfile);
      onProfileUpdated(nextProfile);
      setMessage("个人资料已保存。");
    } catch (saveError) {
      setError(readableError(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function savePrivacy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const nextProfile = await updateMyPrivacy({
        profile_visibility:
          form.get("profile_visibility") === "private" ? "private" : "campus",
        show_activity: form.get("show_activity") === "on",
        allow_direct_messages: form.get("allow_direct_messages") === "on",
      });
      setProfile(nextProfile);
      setMessage("隐私设置已更新。");
    } catch (saveError) {
      setError(readableError(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function removeSession(sessionId: string) {
    setBusy(true);
    setError("");
    try {
      await revokeDeviceSession(sessionId);
      setSessions((current) =>
        current.filter((session) => session.id !== sessionId),
      );
      setMessage("该设备会话已撤销。");
    } catch (removeError) {
      setError(readableError(removeError));
    } finally {
      setBusy(false);
    }
  }

  async function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const nextVerification = await submitCampusVerification({
        school_name: String(form.get("school_name") ?? ""),
        student_identifier: String(form.get("student_identifier") ?? ""),
      });
      setVerification(nextVerification);
      setMessage("认证申请已安全提交，标识不会以明文保存。");
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: AccountTab; label: string }[] = [
    { id: "profile", label: "个人资料" },
    { id: "privacy", label: "隐私设置" },
    { id: "sessions", label: "登录设备" },
    { id: "verification", label: "校园认证" },
  ];

  return (
    <dialog
      aria-labelledby="account-title"
      className="account-dialog"
      onCancel={onClose}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="account-sheet">
        <header className="account-header">
          <div>
            <span className="eyebrow">ACCOUNT & PRIVACY</span>
            <h2 id="account-title">账号与隐私中心</h2>
            <p>管理公开资料、隐私偏好和已登录设备。</p>
          </div>
          <button
            aria-label="关闭账号中心"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="account-body">
          <nav aria-label="账号中心页面" className="account-tabs">
            {tabs.map((item) => (
              <button
                aria-current={tab === item.id ? "page" : undefined}
                key={item.id}
                onClick={() => {
                  setTab(item.id);
                  setError("");
                  setMessage("");
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <section className="account-content">
            {loading ? <p className="account-loading">正在加载账号信息…</p> : null}
            {!loading && profile && tab === "profile" ? (
              <form className="account-form" onSubmit={saveProfile}>
                <div className="account-summary">
                  <span className="account-avatar">
                    {profile.display_name.slice(0, 1)}
                  </span>
                  <div>
                    <strong>@{profile.username}</strong>
                    <small>
                      Lv.{profile.level} · 信誉 {profile.reputation}
                      {profile.campus_verified ? " · 已认证" : " · 未认证"}
                    </small>
                  </div>
                </div>
                <label>
                  <span>显示昵称</span>
                  <input
                    defaultValue={profile.display_name}
                    maxLength={50}
                    name="display_name"
                    required
                  />
                </label>
                <label>
                  <span>个人简介</span>
                  <textarea
                    defaultValue={profile.bio ?? ""}
                    maxLength={500}
                    name="bio"
                    placeholder="介绍一下你关心的校园生活"
                    rows={4}
                  />
                </label>
                <label>
                  <span>头像 HTTPS 地址 <small>选填</small></span>
                  <input
                    defaultValue={profile.avatar_url ?? ""}
                    name="avatar_url"
                    placeholder="https://..."
                    type="url"
                  />
                </label>
                <button className="primary-button" disabled={busy} type="submit">
                  保存个人资料
                </button>
              </form>
            ) : null}

            {!loading && profile && tab === "privacy" ? (
              <form className="account-form" onSubmit={savePrivacy}>
                <label>
                  <span>谁可以查看我的资料</span>
                  <select
                    defaultValue={profile.profile_visibility}
                    name="profile_visibility"
                  >
                    <option value="campus">已登录校园用户</option>
                    <option value="private">仅自己与管理员</option>
                  </select>
                </label>
                <label className="account-check">
                  <input
                    defaultChecked={profile.show_activity}
                    name="show_activity"
                    type="checkbox"
                  />
                  <span>
                    <strong>展示互动动态</strong>
                    <small>允许他人在你的资料页看到公开互动统计。</small>
                  </span>
                </label>
                <label className="account-check">
                  <input
                    defaultChecked={profile.allow_direct_messages}
                    name="allow_direct_messages"
                    type="checkbox"
                  />
                  <span>
                    <strong>允许接收私信</strong>
                    <small>拉黑关系始终优先于这项设置。</small>
                  </span>
                </label>
                <button className="primary-button" disabled={busy} type="submit">
                  保存隐私设置
                </button>
              </form>
            ) : null}

            {!loading && tab === "sessions" ? (
              <div className="session-list">
                <div className="account-section-heading">
                  <h3>活跃登录设备</h3>
                  <p>IP 地址只做不可逆安全关联，不在这里展示。</p>
                </div>
                {sessions.map((session) => (
                  <article className="session-item" key={session.id}>
                    <div>
                      <strong>
                        {session.current ? "当前设备" : "其他设备"}
                      </strong>
                      <p>{session.user_agent ?? "未知浏览器"}</p>
                      <small>登录于 {formatDate(session.created_at)}</small>
                    </div>
                    {session.current ? (
                      <span className="session-current">使用中</span>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => void removeSession(session.id)}
                        type="button"
                      >
                        撤销
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : null}

            {!loading && tab === "verification" ? (
              verification ? (
                <div className="verification-status">
                  <span data-status={verification.status}>
                    {verification.status === "pending"
                      ? "审核中"
                      : verification.status === "approved"
                        ? "已通过"
                        : "未通过"}
                  </span>
                  <h3>{verification.school_name}</h3>
                  <p>
                    申请于 {formatDate(verification.created_at)}。
                    {verification.review_note
                      ? ` 审核说明：${verification.review_note}`
                      : " 审核完成后会在此显示结果。"}
                  </p>
                </div>
              ) : (
                <form className="account-form" onSubmit={submitVerification}>
                  <div className="account-section-heading">
                    <h3>提交校园身份认证</h3>
                    <p>学生标识只保存不可逆校验值，管理员和数据库均不能查看原文。</p>
                  </div>
                  <label>
                    <span>学校名称</span>
                    <input name="school_name" required />
                  </label>
                  <label>
                    <span>学号或校内唯一标识</span>
                    <input
                      autoComplete="off"
                      maxLength={100}
                      minLength={3}
                      name="student_identifier"
                      required
                      type="password"
                    />
                  </label>
                  <button className="primary-button" disabled={busy} type="submit">
                    安全提交认证
                  </button>
                </form>
              )
            ) : null}

            {message ? <p className="account-message" role="status">{message}</p> : null}
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
          </section>
        </div>
      </div>
    </dialog>
  );
}
