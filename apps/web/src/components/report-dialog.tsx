"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import { CloseIcon } from "@/components/icons";
import { ApiError, type ReportCategory, submitReport } from "@/lib/api";

type ReportDialogProps = {
  postId: string;
  postTitle: string;
  onClose: () => void;
  onSubmitted: () => void;
};

const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "harassment", label: "欺凌、辱骂或挂人" },
  { value: "privacy", label: "隐私、肖像或个人信息" },
  { value: "misinformation", label: "谣言或不实信息" },
  { value: "violence", label: "人身威胁或暴力风险" },
  { value: "spam", label: "广告、刷屏或诈骗" },
  { value: "illegal", label: "违法或高风险内容" },
  { value: "other", label: "其他违反社区规范" },
];

export function ReportDialog({
  postId,
  postTitle,
  onClose,
  onSubmitted,
}: ReportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await submitReport({
        target_type: "post",
        target_id: postId,
        category: String(form.get("category")) as ReportCategory,
        description: String(form.get("description") ?? ""),
        emergency: form.get("emergency") === "on",
      });
      onSubmitted();
      dialogRef.current?.close();
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 409) {
        setError("你已经提交过这条内容，处理完成前不需要重复举报。");
      } else {
        setError(
          submitError instanceof ApiError
            ? submitError.message
            : "举报暂时无法提交，请稍后重试。",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      aria-labelledby="report-title"
      className="report-dialog"
      onCancel={onClose}
      onClose={onClose}
      ref={dialogRef}
    >
      <form className="report-sheet" onSubmit={handleSubmit}>
        <header className="composer-header">
          <div>
            <span className="eyebrow">COMMUNITY SAFETY</span>
            <h2 id="report-title">举报这条内容</h2>
            <p title={postTitle}>目标：{postTitle}</p>
          </div>
          <button
            aria-label="关闭举报"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="report-form">
          <label>
            <span>举报原因</span>
            <select defaultValue="harassment" name="category">
              {REPORT_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>具体说明</span>
            <textarea
              maxLength={2000}
              minLength={3}
              name="description"
              placeholder="请说明发生了什么，不要在这里重复传播敏感个人信息。"
              required
              rows={5}
            />
          </label>
          <label className="report-emergency">
            <input name="emergency" type="checkbox" />
            <span>
              <strong>涉及现实人身安全，申请紧急处理</strong>
              <small>仅用于威胁、暴力、失踪或正在发生的严重欺凌。</small>
            </span>
          </label>
          <p className="report-help">
            紧急情况请同时联系老师、学校值班人员或当地紧急服务；平台举报不能替代现实求助。
          </p>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "正在安全提交…" : "提交举报"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
