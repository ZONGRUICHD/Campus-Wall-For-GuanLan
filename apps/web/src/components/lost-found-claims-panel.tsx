"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  ApiError,
  cancelLostFoundClaim,
  createLostFoundClaim,
  fetchMyLostFoundClaims,
  fetchPostLostFoundClaims,
  reviewLostFoundClaim,
  type LostFoundClaim,
  type LostFoundClaimStatus,
} from "@/lib/api";

type LostFoundClaimsPanelProps = {
  canReview: boolean;
  onResolved: () => void;
  postId: string;
  resolved: boolean;
};

const STATUS_LABELS: Record<LostFoundClaimStatus, string> = {
  pending: "待核对",
  accepted: "已确认",
  rejected: "未匹配",
  cancelled: "已撤回",
};

function readableError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "线索服务暂时不可用，请稍后重试。";
}

function formatClaimTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function LostFoundClaimsPanel({
  canReview,
  onResolved,
  postId,
  resolved,
}: LostFoundClaimsPanelProps) {
  const [claims, setClaims] = useState<LostFoundClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const request = canReview
      ? fetchPostLostFoundClaims(postId)
      : fetchMyLostFoundClaims(postId);
    void request
      .then((items) => {
        if (active) setClaims(items);
      })
      .catch((loadError) => {
        if (active) setError(readableError(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canReview, postId]);

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanMessage = message.trim();
    if (cleanMessage.length < 10) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const claim = await createLostFoundClaim(postId, {
        message: cleanMessage,
        anonymous,
      });
      setClaims([claim]);
      setMessage("");
      setNotice("线索已私密提交，等待发布者核对。");
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function reviewClaim(
    claimId: string,
    status: "accepted" | "rejected",
  ) {
    setBusyId(claimId);
    setError("");
    setNotice("");
    try {
      const reviewed = await reviewLostFoundClaim(postId, claimId, status);
      setClaims((current) =>
        current.map((claim) => {
          if (claim.id === claimId) return reviewed;
          if (status === "accepted" && claim.status === "pending") {
            return { ...claim, can_review: false, status: "rejected" };
          }
          return claim;
        }),
      );
      if (status === "accepted") {
        onResolved();
        setNotice("已确认线索并自动将失物信息标记为已解决。");
      } else {
        setNotice("已将这条线索标记为未匹配。");
      }
    } catch (reviewError) {
      setError(readableError(reviewError));
    } finally {
      setBusyId(null);
    }
  }

  async function cancelClaim(claimId: string) {
    setBusyId(claimId);
    setError("");
    setNotice("");
    try {
      await cancelLostFoundClaim(postId, claimId);
      setClaims((current) =>
        current.map((claim) =>
          claim.id === claimId
            ? { ...claim, can_review: false, status: "cancelled" }
            : claim,
        ),
      );
      setNotice("线索已撤回；需要时可以补充信息后重新提交。");
    } catch (cancelError) {
      setError(readableError(cancelError));
    } finally {
      setBusyId(null);
    }
  }

  const myClaim = claims.find((claim) => claim.is_mine) ?? claims[0];
  const canSubmit =
    !canReview &&
    !resolved &&
    (!myClaim ||
      myClaim.status === "rejected" ||
      myClaim.status === "cancelled");

  return (
    <section
      aria-label={canReview ? "认领线索审核" : "我的认领线索"}
      className="lost-found-claims-panel"
    >
      <div className="claims-panel-heading">
        <div>
          <strong>{canReview ? "私密认领线索" : "匿名联系发布者"}</strong>
          <p>
            {canReview
              ? "仅发布者和内容审核员可见；确认一条线索后，其他待核对线索会自动关闭。"
              : "线索不会公开到评论区。请描述只有物品主人知道的细节，不要填写身份证号或银行卡号。"}
          </p>
        </div>
        {canReview && !loading ? <span>{claims.length} 条</span> : null}
      </div>

      {loading ? <p className="claims-state">正在安全读取线索…</p> : null}

      {!loading && canReview && claims.length === 0 ? (
        <p className="claims-state">还没有同学提交认领线索。</p>
      ) : null}

      {!loading && canReview && claims.length > 0 ? (
        <div className="claim-review-list">
          {claims.map((claim) => (
            <article className="claim-review-card" key={claim.id}>
              <div className="claim-review-meta">
                <strong>{claim.claimant_name}</strong>
                {claim.anonymous ? <small>匿名线索</small> : null}
                <time dateTime={claim.created_at}>
                  {formatClaimTime(claim.created_at)}
                </time>
                <span data-status={claim.status}>
                  {STATUS_LABELS[claim.status]}
                </span>
              </div>
              <p>{claim.message}</p>
              {claim.can_review ? (
                <div className="claim-review-actions">
                  <button
                    disabled={busyId === claim.id}
                    onClick={() => void reviewClaim(claim.id, "rejected")}
                    type="button"
                  >
                    不匹配
                  </button>
                  <button
                    className="claim-accept-action"
                    disabled={busyId === claim.id}
                    onClick={() => void reviewClaim(claim.id, "accepted")}
                    type="button"
                  >
                    确认并解决
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !canReview && myClaim ? (
        <article className="my-claim-card" data-status={myClaim.status}>
          <div>
            <strong>我的线索</strong>
            <span>{STATUS_LABELS[myClaim.status]}</span>
          </div>
          <p>{myClaim.message}</p>
          <small>
            {myClaim.anonymous ? "已匿名提交" : "已向发布者显示昵称"} ·{" "}
            {formatClaimTime(myClaim.updated_at)}
          </small>
          {myClaim.status === "pending" ? (
            <button
              disabled={busyId === myClaim.id}
              onClick={() => void cancelClaim(myClaim.id)}
              type="button"
            >
              撤回线索
            </button>
          ) : null}
        </article>
      ) : null}

      {!loading && !canReview && resolved && !myClaim ? (
        <p className="claims-state">这件物品已经解决，当前不再接收新线索。</p>
      ) : null}

      {!loading && canSubmit ? (
        <form className="claim-submit-form" onSubmit={submitClaim}>
          <label>
            <span>
              核对线索 <small>{message.length}/1000</small>
            </span>
            <textarea
              maxLength={1000}
              minLength={10}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="例如：物品内侧的标记、遗失经过，或便于校内联系的方式（至少 10 个字）"
              required
              rows={4}
              value={message}
            />
          </label>
          <div>
            <label className="claim-anonymous-toggle">
              <input
                checked={anonymous}
                disabled={submitting}
                onChange={(event) => setAnonymous(event.target.checked)}
                type="checkbox"
              />
              对发布者隐藏我的昵称
            </label>
            <button
              className="primary-button"
              disabled={submitting || message.trim().length < 10}
              type="submit"
            >
              {submitting
                ? "正在提交…"
                : myClaim
                  ? "补充后重新提交"
                  : "私密提交线索"}
            </button>
          </div>
        </form>
      ) : null}

      {notice ? (
        <p className="claims-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
