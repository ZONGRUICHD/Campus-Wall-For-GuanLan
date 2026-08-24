"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  CheckIcon,
  CloseIcon,
  LocationIcon,
  SearchIcon,
} from "@/components/icons";
import {
  ApiError,
  type GlobalSearchResult,
  type SearchHistoryItem,
  type SearchUserHit,
  type SubscriptionTargetType,
  clearSearchHistory,
  fetchGlobalSearch,
  fetchSearchHistory,
  setUserFollowing,
  subscribeToContent,
  unsubscribeFromContent,
} from "@/lib/api";
import { getBoard, type BoardId } from "@/lib/campus-wall";

type DiscoveryDialogProps = {
  currentUserId: string;
  onClose: () => void;
  onOpenCommunity: () => void;
  onOpenPost: (postId: string, board: BoardId, query: string) => void;
  onSubscriptionsChanged: () => void;
};

function readableError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "全局搜索暂时不可用，请稍后重试。";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function DiscoveryDialog({
  currentUserId,
  onClose,
  onOpenCommunity,
  onOpenPost,
  onSubscriptionsChanged,
}: DiscoveryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    dialogRef.current?.showModal();
    inputRef.current?.focus();
    let active = true;
    void fetchSearchHistory()
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch((historyError) => {
        if (active) setError(readableError(historyError));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function search(rawQuery: string) {
    const cleanQuery = rawQuery.trim();
    if (cleanQuery.length < 2) {
      setError("请输入至少 2 个字符后再搜索。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextResult = await fetchGlobalSearch(cleanQuery);
      setResult(nextResult);
      setQuery(nextResult.query);
      const nextHistory = await fetchSearchHistory();
      setHistory(nextHistory);
    } catch (searchError) {
      setError(readableError(searchError));
    } finally {
      setLoading(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(query);
  }

  async function clearHistory() {
    setBusyId("history");
    setError("");
    try {
      await clearSearchHistory();
      setHistory([]);
    } catch (clearError) {
      setError(readableError(clearError));
    } finally {
      setBusyId("");
    }
  }

  async function toggleFollow(user: SearchUserHit) {
    const key = `user:${user.id}`;
    setBusyId(key);
    setError("");
    try {
      const following = await setUserFollowing(user.id, !user.is_following);
      setResult((current) =>
        current
          ? {
              ...current,
              users: current.users.map((item) =>
                item.id === user.id ? { ...item, is_following: following } : item,
              ),
            }
          : current,
      );
    } catch (followError) {
      setError(readableError(followError));
    } finally {
      setBusyId("");
    }
  }

  async function toggleSubscription(
    targetType: SubscriptionTargetType,
    targetId: string,
    subscribed: boolean,
  ) {
    const key = `${targetType}:${targetId}`;
    setBusyId(key);
    setError("");
    try {
      if (subscribed) {
        await unsubscribeFromContent(targetType, targetId);
      } else {
        await subscribeToContent(targetType, targetId);
      }
      const nextSubscribed = !subscribed;
      setResult((current) => {
        if (!current) return current;
        if (targetType === "club") {
          return {
            ...current,
            clubs: current.clubs.map((item) =>
              item.id === targetId
                ? { ...item, subscribed: nextSubscribed }
                : item,
            ),
          };
        }
        if (targetType === "event") {
          return {
            ...current,
            events: current.events.map((item) =>
              item.id === targetId
                ? { ...item, subscribed: nextSubscribed }
                : item,
            ),
          };
        }
        if (targetType === "tag") {
          return {
            ...current,
            tags: current.tags.map((item) =>
              item.name === targetId
                ? { ...item, subscribed: nextSubscribed }
                : item,
            ),
          };
        }
        return current;
      });
      onSubscriptionsChanged();
    } catch (subscriptionError) {
      setError(readableError(subscriptionError));
    } finally {
      setBusyId("");
    }
  }

  function openCommunity() {
    dialogRef.current?.close();
    onOpenCommunity();
  }

  return (
    <dialog
      aria-labelledby="discovery-title"
      className="discovery-dialog"
      onCancel={onClose}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="discovery-sheet">
        <header className="discovery-header">
          <div>
            <span className="eyebrow">DISCOVER CAMPUS</span>
            <h2 id="discovery-title">全校搜索与发现</h2>
            <p>一次查找便笺、同学、社团、活动和话题。</p>
          </div>
          <button
            aria-label="关闭全校搜索"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <form className="discovery-search-form" onSubmit={submitSearch}>
          <SearchIcon size={20} />
          <label className="sr-only" htmlFor="global-campus-search">
            搜索全校内容
          </label>
          <input
            autoComplete="off"
            id="global-campus-search"
            maxLength={100}
            minLength={2}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索便笺、同学、社团、活动或话题…"
            ref={inputRef}
            type="search"
            value={query}
          />
          {query ? (
            <button
              className="discovery-clear"
              onClick={() => {
                setQuery("");
                setResult(null);
                setError("");
                inputRef.current?.focus();
              }}
              type="button"
            >
              清空
            </button>
          ) : null}
          <button
            className="primary-button"
            disabled={loading || query.trim().length < 2}
            type="submit"
          >
            {loading ? "搜索中…" : "全校搜索"}
          </button>
        </form>

        <section
          aria-busy={loading}
          aria-live="polite"
          className="discovery-content"
        >
          {!result ? (
            <div className="search-history-panel">
              <div className="discovery-section-heading">
                <div>
                  <strong>最近搜索</strong>
                  <p>搜索记录仅保存在你的账号中，最多保留 20 条。</p>
                </div>
                {history.length > 0 ? (
                  <button
                    disabled={busyId === "history"}
                    onClick={() => void clearHistory()}
                    type="button"
                  >
                    清空记录
                  </button>
                ) : null}
              </div>
              {historyLoading ? (
                <p className="account-loading">正在读取搜索记录…</p>
              ) : history.length > 0 ? (
                <div className="search-history-list">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setQuery(item.query);
                        void search(item.query);
                      }}
                      type="button"
                    >
                      <SearchIcon size={15} />
                      <span>{item.query}</span>
                      <time dateTime={item.created_at}>
                        {formatDate(item.created_at)}
                      </time>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="discovery-empty compact">
                  <SearchIcon size={25} />
                  <strong>还没有搜索记录</strong>
                  <p>输入至少 2 个字符，开始发现校园里的内容和同学。</p>
                </div>
              )}
            </div>
          ) : result.total === 0 ? (
            <div className="discovery-empty">
              <SearchIcon size={30} />
              <strong>没有找到“{result.query}”</strong>
              <p>试试更短的关键词、社团简称、活动地点或话题名称。</p>
            </div>
          ) : (
            <div className="discovery-results">
              <p className="discovery-result-summary">
                “{result.query}”共找到 {result.total} 项结果
              </p>

              {result.posts.length > 0 ? (
                <section className="discovery-result-group">
                  <div className="discovery-section-heading">
                    <div>
                      <strong>校园便笺</strong>
                      <p>公开帖子会显示作者，匿名内容不会暴露账号。</p>
                    </div>
                    <span>{result.posts.length}</span>
                  </div>
                  <div className="discovery-card-list">
                    {result.posts.map((post) => (
                      <article className="discovery-post-hit" key={post.id}>
                        <div>
                          <span>{getBoard(post.board).name}</span>
                          <time dateTime={post.created_at}>
                            {formatDate(post.created_at)}
                          </time>
                        </div>
                        <strong>{post.title ?? "无标题便笺"}</strong>
                        <p>{post.excerpt}</p>
                        <small>
                          {post.author_name}
                          {post.tags.length > 0
                            ? ` · ${post.tags.map((tag) => `#${tag}`).join(" ")}`
                            : ""}
                        </small>
                        <button
                          onClick={() => {
                            dialogRef.current?.close();
                            onOpenPost(post.id, post.board, result.query);
                          }}
                          type="button"
                        >
                          在{getBoard(post.board).name}查看
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {result.users.length > 0 ? (
                <section className="discovery-result-group">
                  <div className="discovery-section-heading">
                    <div>
                      <strong>校园同学</strong>
                      <p>只显示允许校内用户查看的公开资料。</p>
                    </div>
                    <span>{result.users.length}</span>
                  </div>
                  <div className="discovery-user-grid">
                    {result.users.map((user) => (
                      <article className="discovery-user-hit" key={user.id}>
                        <span className="discovery-avatar">
                          {user.display_name.slice(0, 1)}
                        </span>
                        <div>
                          <strong>
                            {user.display_name}
                            {user.campus_verified ? (
                              <CheckIcon aria-label="已认证" size={14} />
                            ) : null}
                          </strong>
                          <small>@{user.username}</small>
                          <p>{user.bio ?? "这位同学还没有填写个人简介。"}</p>
                        </div>
                        {user.id === currentUserId ? (
                          <span className="discovery-self-label">这是你</span>
                        ) : (
                          <button
                            aria-pressed={user.is_following}
                            disabled={busyId === `user:${user.id}`}
                            onClick={() => void toggleFollow(user)}
                            type="button"
                          >
                            {user.is_following ? "已关注" : "关注"}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {result.clubs.length > 0 ? (
                <section className="discovery-result-group">
                  <div className="discovery-section-heading">
                    <div>
                      <strong>认证社团</strong>
                      <p>订阅后可收到新公告和新活动通知。</p>
                    </div>
                    <span>{result.clubs.length}</span>
                  </div>
                  <div className="discovery-card-list">
                    {result.clubs.map((club) => (
                      <article className="discovery-entity-hit" key={club.id}>
                        <div>
                          <strong>{club.name}</strong>
                          <small>@{club.slug}</small>
                        </div>
                        <p>{club.description}</p>
                        <div>
                          <button onClick={openCommunity} type="button">
                            查看社团
                          </button>
                          <button
                            aria-pressed={club.subscribed}
                            disabled={busyId === `club:${club.id}`}
                            onClick={() =>
                              void toggleSubscription(
                                "club",
                                club.id,
                                club.subscribed,
                              )
                            }
                            type="button"
                          >
                            {club.subscribed ? "已订阅" : "订阅社团"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {result.events.length > 0 ? (
                <section className="discovery-result-group">
                  <div className="discovery-section-heading">
                    <div>
                      <strong>校园活动</strong>
                      <p>订阅活动后可及时收到状态更新。</p>
                    </div>
                    <span>{result.events.length}</span>
                  </div>
                  <div className="discovery-card-list">
                    {result.events.map((event) => (
                      <article className="discovery-entity-hit" key={event.id}>
                        <div>
                          <strong>{event.title}</strong>
                          <small>{event.club_name}</small>
                        </div>
                        <p>{event.description}</p>
                        <small className="discovery-location">
                          <LocationIcon size={14} />
                          {event.location} · {formatDate(event.starts_at)}
                        </small>
                        <div>
                          <button onClick={openCommunity} type="button">
                            查看活动
                          </button>
                          <button
                            aria-pressed={event.subscribed}
                            disabled={busyId === `event:${event.id}`}
                            onClick={() =>
                              void toggleSubscription(
                                "event",
                                event.id,
                                event.subscribed,
                              )
                            }
                            type="button"
                          >
                            {event.subscribed ? "已订阅" : "订阅活动"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {result.tags.length > 0 ? (
                <section className="discovery-result-group">
                  <div className="discovery-section-heading">
                    <div>
                      <strong>校园话题</strong>
                      <p>订阅话题后，新帖发布时会进入消息中心。</p>
                    </div>
                    <span>{result.tags.length}</span>
                  </div>
                  <div className="discovery-tag-list">
                    {result.tags.map((tag) => (
                      <button
                        aria-pressed={tag.subscribed}
                        disabled={busyId === `tag:${tag.name}`}
                        key={tag.name}
                        onClick={() =>
                          void toggleSubscription(
                            "tag",
                            tag.name,
                            tag.subscribed,
                          )
                        }
                        type="button"
                      >
                        <strong>#{tag.name}</strong>
                        <span>{tag.post_count} 条便笺</span>
                        <small>{tag.subscribed ? "已订阅" : "订阅话题"}</small>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
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
