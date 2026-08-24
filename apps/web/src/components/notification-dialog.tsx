"use client";

import { useEffect, useRef, useState } from "react";

import { BellIcon, CloseIcon, RefreshIcon } from "@/components/icons";
import {
  ApiError,
  type CampusNotification,
  fetchNotifications,
  markNotificationsRead,
} from "@/lib/api";

type NotificationDialogProps = {
  onClose: () => void;
  onOpenCommunity: () => void;
  onOpenPost: (postId: string) => void;
  onUnreadCountChange: (count: number) => void;
};

const TYPE_LABELS: Record<CampusNotification["type"], string> = {
  comment: "评论",
  reply: "回复",
  reaction: "互动",
  follow: "关注",
  membership: "社团",
  announcement: "公告",
  event: "活动",
  subscription: "订阅",
  moderation: "治理",
  system: "系统",
};

function readableError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "消息中心暂时不可用，请稍后重试。";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function canOpenRelated(item: CampusNotification): boolean {
  return (
    item.entity_type === "post" ||
    item.entity_type === "club" ||
    item.entity_type === "event" ||
    item.entity_type === "announcement"
  );
}

export function NotificationDialog({
  onClose,
  onOpenCommunity,
  onOpenPost,
  onUnreadCountChange,
}: NotificationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<CampusNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    void fetchNotifications({ unreadOnly })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setTotal(page.total);
        setNextCursor(page.next_cursor);
        setError("");
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
  }, [unreadOnly]);

  function chooseFilter(nextUnreadOnly: boolean) {
    if (nextUnreadOnly === unreadOnly) return;
    setLoading(true);
    setItems([]);
    setTotal(0);
    setNextCursor(null);
    setError("");
    setUnreadOnly(nextUnreadOnly);
  }

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const page = await fetchNotifications({ unreadOnly });
      setItems(page.items);
      setTotal(page.total);
      setNextCursor(page.next_cursor);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await fetchNotifications({
        unreadOnly,
        cursor: nextCursor,
      });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoadingMore(false);
    }
  }

  async function markOne(item: CampusNotification): Promise<void> {
    if (item.read) return;
    setBusyId(item.id);
    setError("");
    try {
      const remaining = await markNotificationsRead({ ids: [item.id] });
      onUnreadCountChange(remaining);
      if (unreadOnly) {
        setItems((current) =>
          current.filter((notification) => notification.id !== item.id),
        );
        setTotal((current) => Math.max(0, current - 1));
      } else {
        setItems((current) =>
          current.map((notification) =>
            notification.id === item.id
              ? { ...notification, read: true }
              : notification,
          ),
        );
      }
    } catch (markError) {
      setError(readableError(markError));
      throw markError;
    } finally {
      setBusyId("");
    }
  }

  async function markAll() {
    if (items.every((item) => item.read) && !unreadOnly) return;
    setBusyId("all");
    setError("");
    try {
      const remaining = await markNotificationsRead({ all: true });
      onUnreadCountChange(remaining);
      if (unreadOnly) {
        setItems([]);
        setTotal(0);
        setNextCursor(null);
      } else {
        setItems((current) =>
          current.map((notification) => ({ ...notification, read: true })),
        );
      }
    } catch (markError) {
      setError(readableError(markError));
    } finally {
      setBusyId("");
    }
  }

  async function openRelated(item: CampusNotification) {
    try {
      await markOne(item);
    } catch {
      return;
    }
    dialogRef.current?.close();
    if (item.entity_type === "post") {
      onOpenPost(item.entity_id);
      return;
    }
    onOpenCommunity();
  }

  return (
    <dialog
      aria-labelledby="notification-title"
      className="notification-dialog"
      onCancel={onClose}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="notification-sheet">
        <header className="account-header notification-header">
          <div>
            <span className="eyebrow">INBOX</span>
            <h2 id="notification-title">消息通知</h2>
            <p>互动、订阅、社团与活动动态统一收在这里。</p>
          </div>
          <button
            aria-label="关闭消息通知"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="notification-toolbar">
          <div aria-label="消息筛选" className="notification-filters">
            <button
              aria-pressed={!unreadOnly}
              onClick={() => chooseFilter(false)}
              type="button"
            >
              全部消息
            </button>
            <button
              aria-pressed={unreadOnly}
              onClick={() => chooseFilter(true)}
              type="button"
            >
              仅看未读
            </button>
          </div>
          <span>{loading ? "正在同步…" : `${total} 条消息`}</span>
          <button
            className="notification-refresh"
            disabled={loading}
            onClick={() => void reload()}
            type="button"
          >
            <RefreshIcon size={15} />
            刷新
          </button>
          <button
            className="notification-mark-all"
            disabled={busyId === "all" || loading || total === 0}
            onClick={() => void markAll()}
            type="button"
          >
            全部已读
          </button>
        </div>

        <section
          aria-busy={loading}
          aria-live="polite"
          className="notification-content"
        >
          {loading ? (
            <p className="account-loading">正在整理最新消息…</p>
          ) : items.length > 0 ? (
            <div className="notification-list">
              {items.map((item) => (
                <article
                  className="notification-item"
                  data-read={item.read}
                  key={item.id}
                >
                  <span
                    aria-hidden="true"
                    className="notification-type-icon"
                    data-type={item.type}
                  >
                    <BellIcon size={16} />
                  </span>
                  <div className="notification-copy">
                    <div>
                      <span>{TYPE_LABELS[item.type]}</span>
                      {!item.read ? <i>未读</i> : null}
                      <time dateTime={item.created_at}>
                        {formatDate(item.created_at)}
                      </time>
                    </div>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                    <small>来自：{item.actor_name}</small>
                  </div>
                  <div className="notification-actions">
                    {canOpenRelated(item) ? (
                      <button
                        className="primary-button"
                        disabled={busyId === item.id}
                        onClick={() => void openRelated(item)}
                        type="button"
                      >
                        查看相关内容
                      </button>
                    ) : null}
                    {!item.read ? (
                      <button
                        disabled={busyId === item.id}
                        onClick={() => void markOne(item)}
                        type="button"
                      >
                        标为已读
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
              {nextCursor ? (
                <button
                  className="notification-load-more"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  type="button"
                >
                  {loadingMore ? "正在加载…" : "加载更早消息"}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="notification-empty">
              <BellIcon size={28} />
              <strong>{unreadOnly ? "没有未读消息" : "消息箱还是空的"}</strong>
              <p>
                {unreadOnly
                  ? "所有消息都已经处理完了。"
                  : "关注同学、订阅板块或参加活动后，动态会出现在这里。"}
              </p>
            </div>
          )}
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </dialog>
  );
}
