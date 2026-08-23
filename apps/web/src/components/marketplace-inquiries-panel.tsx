"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  ApiError,
  cancelMarketplaceInquiry,
  createMarketplaceInquiry,
  fetchMyMarketplaceInquiries,
  fetchPostMarketplaceInquiries,
  replyMarketplaceInquiry,
  type MarketplaceInquiry,
  type MarketplaceInquiryStatus,
} from "@/lib/api";
import type { MarketplaceStatus } from "@/lib/campus-wall";

type MarketplaceInquiriesPanelProps = {
  canManage: boolean;
  listingStatus: MarketplaceStatus;
  postId: string;
};

const STATUS_LABELS: Record<MarketplaceInquiryStatus, string> = {
  pending: "等待卖家回复",
  replied: "卖家已回复",
  closed: "对话已结束",
  cancelled: "已撤回",
};

function readableError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "私密询价服务暂时不可用，请稍后重试。";
}

function formatInquiryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function MarketplaceInquiriesPanel({
  canManage,
  listingStatus,
  postId,
}: MarketplaceInquiriesPanelProps) {
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const request = canManage
      ? fetchPostMarketplaceInquiries(postId)
      : fetchMyMarketplaceInquiries(postId);
    void request
      .then((items) => {
        if (active) setInquiries(items);
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
  }, [canManage, postId]);

  async function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanMessage = message.trim();
    if (cleanMessage.length < 10) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const inquiry = await createMarketplaceInquiry(postId, {
        message: cleanMessage,
        anonymous,
      });
      setInquiries([inquiry]);
      setMessage("");
      setNotice("询价已私密发送，只有卖家和审核人员可见。");
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function sendReply(inquiryId: string, status: "replied" | "closed") {
    const sellerReply = (replyDrafts[inquiryId] ?? "").trim();
    if (sellerReply.length < 2) return;
    setBusyId(inquiryId);
    setError("");
    setNotice("");
    try {
      const replied = await replyMarketplaceInquiry(postId, inquiryId, {
        seller_reply: sellerReply,
        status,
      });
      setInquiries((current) =>
        current.map((item) => (item.id === inquiryId ? replied : item)),
      );
      setReplyDrafts((current) => ({ ...current, [inquiryId]: "" }));
      setNotice(
        status === "closed"
          ? "回复已发送，这次询价已结束。"
          : "回复已私密发送给买家。",
      );
    } catch (replyError) {
      setError(readableError(replyError));
    } finally {
      setBusyId(null);
    }
  }

  async function cancelInquiry(inquiryId: string) {
    setBusyId(inquiryId);
    setError("");
    setNotice("");
    try {
      await cancelMarketplaceInquiry(postId, inquiryId);
      setInquiries((current) =>
        current.map((item) =>
          item.id === inquiryId ? { ...item, status: "cancelled" } : item,
        ),
      );
      setNotice("询价已撤回，需要时可以整理信息后重新提交。");
    } catch (cancelError) {
      setError(readableError(cancelError));
    } finally {
      setBusyId(null);
    }
  }

  const myInquiry =
    inquiries.find((inquiry) => inquiry.is_mine) ?? inquiries[0];
  const acceptsInquiries =
    listingStatus === "available" || listingStatus === "reserved";
  const canSubmit =
    !canManage &&
    acceptsInquiries &&
    (!myInquiry ||
      myInquiry.status === "closed" ||
      myInquiry.status === "cancelled");

  return (
    <section
      aria-label={canManage ? "商品询价管理" : "我的商品询价"}
      className="lost-found-claims-panel marketplace-inquiries-panel"
    >
      <div className="claims-panel-heading">
        <div>
          <strong>{canManage ? "私密购买询价" : "私密联系卖家"}</strong>
          <p>
            {canManage
              ? "询价不会显示在公开评论区。请在校内公共区域面交，验货后再确认交易。"
              : "请只沟通商品和校内面交安排，不要发送身份证号、银行卡号、短信验证码或站外付款链接。"}
          </p>
        </div>
        {canManage && !loading ? <span>{inquiries.length} 条</span> : null}
      </div>

      {loading ? <p className="claims-state">正在安全读取询价…</p> : null}

      {!loading && canManage && inquiries.length === 0 ? (
        <p className="claims-state">还没有同学发来购买询价。</p>
      ) : null}

      {!loading && canManage && inquiries.length > 0 ? (
        <div className="claim-review-list">
          {inquiries.map((inquiry) => (
            <article className="claim-review-card" key={inquiry.id}>
              <div className="claim-review-meta">
                <strong>{inquiry.buyer_name}</strong>
                {inquiry.anonymous ? <small>匿名询价</small> : null}
                <time dateTime={inquiry.created_at}>
                  {formatInquiryTime(inquiry.created_at)}
                </time>
                <span data-status={inquiry.status}>
                  {STATUS_LABELS[inquiry.status]}
                </span>
              </div>
              <p>{inquiry.message}</p>
              {inquiry.seller_reply ? (
                <div className="marketplace-reply-copy">
                  <strong>我的回复</strong>
                  <p>{inquiry.seller_reply}</p>
                </div>
              ) : null}
              {inquiry.can_reply ? (
                <form
                  className="marketplace-reply-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendReply(inquiry.id, "replied");
                  }}
                >
                  <label>
                    <span>私密回复买家</span>
                    <textarea
                      disabled={busyId === inquiry.id}
                      maxLength={1000}
                      minLength={2}
                      onChange={(event) =>
                        setReplyDrafts((current) => ({
                          ...current,
                          [inquiry.id]: event.target.value,
                        }))
                      }
                      placeholder="说明商品细节和校内面交时间，避免发送敏感信息。"
                      required
                      rows={3}
                      value={replyDrafts[inquiry.id] ?? ""}
                    />
                  </label>
                  <div>
                    <button
                      disabled={
                        busyId === inquiry.id ||
                        (replyDrafts[inquiry.id] ?? "").trim().length < 2
                      }
                      onClick={() => void sendReply(inquiry.id, "closed")}
                      type="button"
                    >
                      回复并结束
                    </button>
                    <button
                      className="primary-button"
                      disabled={
                        busyId === inquiry.id ||
                        (replyDrafts[inquiry.id] ?? "").trim().length < 2
                      }
                      type="submit"
                    >
                      私密回复
                    </button>
                  </div>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !canManage && myInquiry ? (
        <article className="my-claim-card" data-status={myInquiry.status}>
          <div>
            <strong>我的询价</strong>
            <span>{STATUS_LABELS[myInquiry.status]}</span>
          </div>
          <p>{myInquiry.message}</p>
          {myInquiry.seller_reply ? (
            <div className="marketplace-reply-copy">
              <strong>卖家回复</strong>
              <p>{myInquiry.seller_reply}</p>
            </div>
          ) : null}
          <small>
            {myInquiry.anonymous ? "已向卖家隐藏昵称" : "已向卖家显示昵称"} ·{" "}
            {formatInquiryTime(myInquiry.updated_at)}
          </small>
          {myInquiry.status === "pending" || myInquiry.status === "replied" ? (
            <button
              disabled={busyId === myInquiry.id}
              onClick={() => void cancelInquiry(myInquiry.id)}
              type="button"
            >
              撤回询价
            </button>
          ) : null}
        </article>
      ) : null}

      {!loading && !canManage && !acceptsInquiries && !myInquiry ? (
        <p className="claims-state">
          {listingStatus === "sold"
            ? "这件商品已售出，不再接收新询价。"
            : "这件商品已下架，不再接收新询价。"}
        </p>
      ) : null}

      {!loading && canSubmit ? (
        <form className="claim-submit-form" onSubmit={submitInquiry}>
          <label>
            <span>
              购买询价 <small>{message.length}/1000</small>
            </span>
            <textarea
              maxLength={1000}
              minLength={10}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="例如：询问商品细节、验货方式和校内面交时间（至少 10 个字）"
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
              对卖家隐藏我的昵称
            </label>
            <button
              className="primary-button"
              disabled={submitting || message.trim().length < 10}
              type="submit"
            >
              {submitting
                ? "正在发送…"
                : myInquiry
                  ? "重新发起询价"
                  : "私密询价"}
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
