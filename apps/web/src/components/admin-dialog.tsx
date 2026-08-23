"use client";

import { useEffect, useRef, useState } from "react";

import { CloseIcon } from "@/components/icons";
import {
  type AuditEntry,
  type CampusReport,
  fetchAdminReports,
  fetchAuditEntries,
  reviewAdminReport,
} from "@/lib/api";

type AdminDialogProps = {
  onClose: () => void;
  onContentChanged: () => void;
};

const CATEGORY_LABELS: Record<CampusReport["category"], string> = {
  harassment: "欺凌 / 辱骂",
  privacy: "隐私 / 个人信息",
  misinformation: "谣言 / 不实信息",
  violence: "威胁 / 暴力",
  spam: "广告 / 诈骗",
  illegal: "违法内容",
  other: "其他",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AdminDialog({
  onClose,
  onContentChanged,
}: AdminDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"reports" | "audit">("reports");
  const [reports, setReports] = useState<CampusReport[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    dialogRef.current?.showModal();
    void Promise.all([
      fetchAdminReports("submitted"),
      fetchAdminReports("in_review"),
      fetchAuditEntries(),
    ])
      .then(([submitted, inReview, audit]) => {
        setReports([...submitted, ...inReview]);
        setAuditEntries(audit);
      })
      .catch(() => setError("管理数据加载失败，请检查管理员权限。"))
      .finally(() => setLoading(false));
  }, []);

  async function updateReport(
    report: CampusReport,
    nextStatus: "in_review" | "resolved" | "rejected",
  ) {
    const resolution = resolutions[report.id]?.trim();
    if (nextStatus !== "in_review" && !resolution) {
      setError("结案或驳回前必须填写处置说明。");
      return;
    }
    setBusyId(report.id);
    setError("");
    try {
      const updated = await reviewAdminReport(report.id, {
        status: nextStatus,
        resolution,
        hide_target: nextStatus === "resolved",
      });
      if (nextStatus === "in_review") {
        setReports((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      } else {
        setReports((current) =>
          current.filter((item) => item.id !== updated.id),
        );
        if (nextStatus === "resolved") onContentChanged();
      }
      setAuditEntries(await fetchAuditEntries());
    } catch {
      setError("处置没有保存，请确认目标仍存在且报告尚未结案。");
    } finally {
      setBusyId("");
    }
  }

  return (
    <dialog
      aria-labelledby="admin-title"
      className="admin-dialog"
      onCancel={onClose}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="admin-sheet">
        <header className="account-header admin-header">
          <div>
            <span className="eyebrow">SAFETY OPERATIONS</span>
            <h2 id="admin-title">校园墙治理台</h2>
            <p>举报优先级、人工处置与管理员审计。</p>
          </div>
          <button
            aria-label="关闭治理台"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <CloseIcon size={18} />
          </button>
        </header>
        <div aria-label="治理台页面" className="admin-tabs" role="tablist">
          <button
            aria-selected={tab === "reports"}
            onClick={() => setTab("reports")}
            role="tab"
            type="button"
          >
            举报队列 <span>{reports.length}</span>
          </button>
          <button
            aria-selected={tab === "audit"}
            onClick={() => setTab("audit")}
            role="tab"
            type="button"
          >
            操作审计
          </button>
        </div>
        <section className="admin-content">
          {loading ? <p className="account-loading">正在加载治理数据…</p> : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}

          {!loading && tab === "reports" ? (
            reports.length > 0 ? (
              <div className="admin-report-list">
                {reports.map((report) => (
                  <article className="admin-report-card" key={report.id}>
                    <div className="admin-report-top">
                      <div>
                        <span
                          className="report-priority"
                          data-emergency={report.emergency}
                        >
                          {report.emergency ? "紧急" : `P${report.priority}`}
                        </span>
                        <strong>{CATEGORY_LABELS[report.category]}</strong>
                      </div>
                      <time dateTime={report.created_at}>
                        {formatDate(report.created_at)}
                      </time>
                    </div>
                    <p>{report.description}</p>
                    <small>
                      目标 {report.target_type} #{report.target_id} ·{" "}
                      {report.status === "in_review" ? "处理中" : "待处理"}
                    </small>
                    <textarea
                      aria-label="处置说明"
                      maxLength={2000}
                      onChange={(event) =>
                        setResolutions((current) => ({
                          ...current,
                          [report.id]: event.target.value,
                        }))
                      }
                      placeholder="记录判断依据、处置结果和后续建议…"
                      rows={3}
                      value={resolutions[report.id] ?? ""}
                    />
                    <div className="admin-report-actions">
                      {report.status === "submitted" ? (
                        <button
                          disabled={busyId === report.id}
                          onClick={() =>
                            void updateReport(report, "in_review")
                          }
                          type="button"
                        >
                          开始处理
                        </button>
                      ) : null}
                      <button
                        disabled={busyId === report.id}
                        onClick={() => void updateReport(report, "rejected")}
                        type="button"
                      >
                        驳回举报
                      </button>
                      <button
                        className="danger-action"
                        disabled={busyId === report.id}
                        onClick={() => void updateReport(report, "resolved")}
                        type="button"
                      >
                        下架并结案
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="admin-empty">
                <strong>当前没有待处理举报</strong>
                <p>新的举报会按紧急程度和提交时间排列。</p>
              </div>
            )
          ) : null}

          {!loading && tab === "audit" ? (
            <div className="audit-list">
              {auditEntries.map((entry) => (
                <article key={entry.id}>
                  <span>{entry.action}</span>
                  <strong>
                    {entry.target_type}
                    {entry.target_id ? ` #${entry.target_id}` : ""}
                  </strong>
                  <time dateTime={entry.created_at}>
                    {formatDate(entry.created_at)}
                  </time>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </dialog>
  );
}
