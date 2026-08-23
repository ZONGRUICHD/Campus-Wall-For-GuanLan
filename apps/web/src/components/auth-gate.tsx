"use client";

import { type FormEvent, useState } from "react";

import { WallLogoIcon } from "@/components/icons";
import {
  ApiError,
  changePassword,
  type AuthSession,
  login,
  logout,
  register,
} from "@/lib/api";

type AuthGateProps = {
  onAuthenticated: (session: AuthSession) => void;
  notice?: string;
};

function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "用户名或密码不正确。";
    if (error.status === 409) return "用户名或邮箱已经注册。";
    if (error.status === 429) return "登录尝试过多，请稍后再试。";
    return error.message;
  }
  return "校园服务暂时不可用，请稍后重试。";
}

export function AuthGate({ onAuthenticated, notice }: AuthGateProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "");
    const password = String(form.get("password") ?? "");

    try {
      const session =
        mode === "login"
          ? await login(username, password)
          : await register({
              username,
              password,
              display_name: String(form.get("display_name") ?? ""),
              email: String(form.get("email") ?? "") || undefined,
            });
      onAuthenticated(session);
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setError("");
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="校园墙介绍">
        <div className="auth-brand">
          <span className="brand-mark">
            <WallLogoIcon size={28} />
          </span>
          <div>
            <strong>观澜校园墙</strong>
            <small>GUANLAN CAMPUS WALL</small>
          </div>
        </div>
        <div className="auth-story-copy">
          <span className="eyebrow">A SAFE CAMPUS COMMUNITY</span>
          <h1>让校园里的每一句真诚，都有安全的回声。</h1>
          <p>校园资讯、失物招领、日常分享、表白与树洞，都在经过身份保护的校园社区里发生。</p>
        </div>
        <ul className="auth-promises">
          <li><span>01</span> 校园身份与分级权限</li>
          <li><span>02</span> 匿名展示，后台严格隔离</li>
          <li><span>03</span> 举报、审核和操作全程留痕</li>
        </ul>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-panel-heading">
          <span className="eyebrow">{mode === "login" ? "WELCOME BACK" : "JOIN THE WALL"}</span>
          <h2 id="auth-title">{mode === "login" ? "登录校园墙" : "创建校园账号"}</h2>
          <p>
            {mode === "login"
              ? "使用你的校园墙账号继续。"
              : "注册后即可发布、评论和参与校园服务。"}
          </p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="账号操作">
          <button
            aria-selected={mode === "login"}
            onClick={() => switchMode("login")}
            role="tab"
            type="button"
          >
            登录
          </button>
          <button
            aria-selected={mode === "register"}
            onClick={() => switchMode("register")}
            role="tab"
            type="button"
          >
            注册
          </button>
        </div>

        {notice ? <p className="auth-notice" role="status">{notice}</p> : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <>
              <label>
                <span>显示昵称</span>
                <input
                  autoComplete="name"
                  maxLength={50}
                  name="display_name"
                  placeholder="同学们会看到的名字"
                  required
                />
              </label>
              <label>
                <span>校园邮箱 <small>选填</small></span>
                <input
                  autoComplete="email"
                  maxLength={320}
                  name="email"
                  placeholder="name@example.edu"
                  type="email"
                />
              </label>
            </>
          ) : null}

          <label>
            <span>用户名</span>
            <input
              autoCapitalize="none"
              autoComplete="username"
              maxLength={32}
              minLength={3}
              name="username"
              pattern="[A-Za-z0-9_.-]+"
              placeholder="3–32 位字母、数字或 _.-"
              required
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              maxLength={128}
              minLength={8}
              name="password"
              placeholder="至少 8 位，包含字母和数字"
              required
              type="password"
            />
          </label>

          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="primary-button auth-submit" disabled={busy} type="submit">
            {busy ? "正在连接…" : mode === "login" ? "安全登录" : "注册并进入"}
          </button>
        </form>

        <p className="auth-policy">
          继续即表示你愿意遵守社区规范。请勿发布他人真实姓名、班级、联系方式或未经允许的照片。
        </p>
      </section>
    </main>
  );
}

type PasswordChangeGateProps = {
  username: string;
  onComplete: () => void;
  onSignOut: () => void;
};

export function PasswordChangeGate({
  username,
  onComplete,
  onSignOut,
}: PasswordChangeGateProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("current_password") ?? "");
    const newPassword = String(form.get("new_password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致。");
      return;
    }

    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      onComplete();
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page auth-page-forced-change">
      <section className="auth-panel auth-change-panel" aria-labelledby="change-title">
        <div className="auth-security-mark" aria-hidden="true">!</div>
        <div className="auth-panel-heading">
          <span className="eyebrow">SECURITY FIRST</span>
          <h2 id="change-title">首次登录，请修改初始密码</h2>
          <p>账号 <strong>{username}</strong> 的初始密码只能用于首次登录。修改后所有旧会话会立即失效。</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>当前密码</span>
            <input autoComplete="current-password" name="current_password" required type="password" />
          </label>
          <label>
            <span>新密码</span>
            <input
              autoComplete="new-password"
              minLength={8}
              name="new_password"
              placeholder="至少 8 位，包含字母和数字"
              required
              type="password"
            />
          </label>
          <label>
            <span>再次输入新密码</span>
            <input autoComplete="new-password" minLength={8} name="confirmation" required type="password" />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="primary-button auth-submit" disabled={busy} type="submit">
            {busy ? "正在更新…" : "修改密码并重新登录"}
          </button>
          <button
            className="auth-secondary-button"
            disabled={busy}
            onClick={() => {
              void logout().finally(onSignOut);
            }}
            type="button"
          >
            退出并返回登录
          </button>
        </form>
      </section>
    </main>
  );
}
