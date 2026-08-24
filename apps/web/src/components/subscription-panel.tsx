"use client";

import { useEffect, useState } from "react";

import { RefreshIcon } from "@/components/icons";
import {
  ApiError,
  type ContentSubscription,
  fetchSubscriptions,
  unsubscribeFromContent,
} from "@/lib/api";

type SubscriptionPanelProps = {
  onChanged: () => void;
};

const TARGET_LABELS: Record<ContentSubscription["target_type"], string> = {
  board: "校园板块",
  tag: "话题",
  club: "认证社团",
  event: "校园活动",
};

function readableError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "订阅列表暂时不可用，请稍后重试。";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近订阅";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
  }).format(date);
}

export function SubscriptionPanel({ onChanged }: SubscriptionPanelProps) {
  const [items, setItems] = useState<ContentSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetchSubscriptions()
      .then((subscriptions) => {
        if (active) setItems(subscriptions);
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
  }, []);

  async function reload() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      setItems(await fetchSubscriptions());
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function remove(item: ContentSubscription) {
    const key = `${item.target_type}:${item.target_id}`;
    setBusyId(key);
    setError("");
    setMessage("");
    try {
      await unsubscribeFromContent(item.target_type, item.target_id);
      setItems((current) =>
        current.filter(
          (subscription) =>
            subscription.target_type !== item.target_type ||
            subscription.target_id !== item.target_id,
        ),
      );
      setMessage(`已取消订阅“${item.label}”。`);
      onChanged();
    } catch (removeError) {
      setError(readableError(removeError));
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="subscription-panel">
      <div className="my-content-heading">
        <div className="account-section-heading">
          <h3>我的订阅</h3>
          <p>板块、话题、社团和活动更新会进入消息中心。</p>
        </div>
        <button disabled={loading} onClick={() => void reload()} type="button">
          <RefreshIcon size={14} />
          刷新
        </button>
      </div>

      {loading ? (
        <p className="account-loading">正在读取订阅列表…</p>
      ) : items.length > 0 ? (
        <div className="subscription-list">
          {items.map((item) => {
            const key = `${item.target_type}:${item.target_id}`;
            return (
              <article key={key}>
                <span data-type={item.target_type}>
                  {TARGET_LABELS[item.target_type]}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <small>订阅于 {formatDate(item.created_at)}</small>
                </div>
                <button
                  disabled={busyId === key}
                  onClick={() => void remove(item)}
                  type="button"
                >
                  取消订阅
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="my-content-empty">
          <strong>还没有订阅内容</strong>
          <p>可在校园墙板块、全校搜索或社团活动中心添加订阅。</p>
        </div>
      )}

      {message ? (
        <p className="account-message" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
