"use client";

/* User media has runtime URLs, so static-exported pages use native images. */
/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  MediaPicker,
  revokeSelectedPostImages,
  type SelectedPostImage,
} from "@/components/media-picker";
import {
  ApiError,
  debugClientLog,
  deleteMediaUpload,
  deletePost,
  fetchMyPosts,
  updatePost,
  uploadPostImages,
  type UpdatePostInput,
} from "@/lib/api";
import {
  centsToYuanInput,
  formatMarketplacePrice,
  getBoard,
  LOST_FOUND_CATEGORIES,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CONDITIONS,
  MARKETPLACE_STATUSES,
  MARKETPLACE_TRADE_METHODS,
  yuanToCents,
  type LostFoundCategory,
  type LostFoundKind,
  type MarketplaceCategory,
  type MarketplaceCondition,
  type MarketplaceStatus,
  type MarketplaceTradeMethod,
  type PublicationStatus,
  type WallPost,
} from "@/lib/campus-wall";

type ContentFilter = "all" | PublicationStatus;

type MyContentPanelProps = {
  onContentChanged: () => void;
};

type PostEditorProps = {
  busy: boolean;
  onCancel: () => void;
  onSave: (input: UpdatePostInput) => Promise<void>;
  post: WallPost;
};

const STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: "草稿",
  scheduled: "待定时发布",
  published: "已发布",
};

function readableError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "内容服务暂时不可用，请稍后重试。";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toDateTimeLocal(value?: string | Date): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localTime = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTime).toISOString().slice(0, 16);
}

function PostEditor({ busy, onCancel, onSave, post }: PostEditorProps) {
  const [publicationStatus, setPublicationStatus] = useState<PublicationStatus>(
    post.publication_status ?? "published",
  );
  const [scheduledFor, setScheduledFor] = useState(
    toDateTimeLocal(post.scheduled_for),
  );
  const [commentsEnabled, setCommentsEnabled] = useState(
    post.comments_enabled !== false,
  );
  const [isAnonymous, setIsAnonymous] = useState(post.is_anonymous);
  const [lostFoundType, setLostFoundType] = useState<LostFoundKind>(
    post.lost_found_type ?? "lost",
  );
  const [itemCategory, setItemCategory] = useState<LostFoundCategory>(
    post.item_category ?? "other",
  );
  const [occurredAt, setOccurredAt] = useState(
    toDateTimeLocal(post.occurred_at),
  );
  const [marketplaceCategory, setMarketplaceCategory] =
    useState<MarketplaceCategory>(post.marketplace?.category ?? "other");
  const [marketplaceCondition, setMarketplaceCondition] =
    useState<MarketplaceCondition>(post.marketplace?.condition ?? "good");
  const [marketplacePrice, setMarketplacePrice] = useState(
    centsToYuanInput(post.marketplace?.price_cents),
  );
  const [marketplaceOriginalPrice, setMarketplaceOriginalPrice] = useState(
    centsToYuanInput(post.marketplace?.original_price_cents),
  );
  const [marketplaceNegotiable, setMarketplaceNegotiable] = useState(
    post.marketplace?.negotiable ?? false,
  );
  const [marketplaceTradeMethod, setMarketplaceTradeMethod] =
    useState<MarketplaceTradeMethod>(
      post.marketplace?.trade_method ?? "campus_meetup",
    );
  const [marketplaceLocation, setMarketplaceLocation] = useState(
    post.marketplace?.meetup_location ?? "",
  );
  const [marketplaceStatus, setMarketplaceStatus] = useState<MarketplaceStatus>(
    post.marketplace?.status ?? "available",
  );
  const [retainedMedia, setRetainedMedia] = useState(post.media ?? []);
  const [selectedMedia, setSelectedMedia] = useState<SelectedPostImage[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [validationError, setValidationError] = useState("");
  const selectedMediaRef = useRef<SelectedPostImage[]>([]);

  useEffect(() => {
    selectedMediaRef.current = selectedMedia;
  }, [selectedMedia]);

  useEffect(() => () => revokeSelectedPostImages(selectedMediaRef.current), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError("");
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const content = String(form.get("content") ?? "").trim();
    const tags = String(form.get("tags") ?? "")
      .split(/[，,\s]+/)
      .map((tag) => tag.replace(/^#/, "").trim())
      .filter(Boolean)
      .slice(0, 8);

    const input: UpdatePostInput = {
      title: title || null,
      content,
      tags,
      is_anonymous: post.category === "marketplace" ? false : isAnonymous,
      comments_enabled: commentsEnabled,
      publication_status: publicationStatus,
    };
    if (post.category === "lost_found") {
      input.lost_found_type = lostFoundType;
      input.item_category = itemCategory;
      input.location = String(form.get("location") ?? "").trim();
      input.occurred_at = new Date(occurredAt).toISOString();
    }
    if (post.category === "marketplace") {
      const priceCents = yuanToCents(marketplacePrice);
      const originalPriceCents = marketplaceOriginalPrice.trim()
        ? yuanToCents(marketplaceOriginalPrice)
        : null;
      if (
        priceCents === null ||
        (marketplaceOriginalPrice.trim() && originalPriceCents === null)
      ) {
        setValidationError("请填写有效价格，最多保留两位小数。");
        return;
      }
      if (originalPriceCents !== null && originalPriceCents < priceCents) {
        setValidationError("原价不能低于当前售价。");
        return;
      }
      input.marketplace = {
        category: marketplaceCategory,
        condition: marketplaceCondition,
        price_cents: priceCents,
        original_price_cents: originalPriceCents,
        negotiable: marketplaceNegotiable,
        trade_method: marketplaceTradeMethod,
        meetup_location: marketplaceLocation.trim(),
        status: marketplaceStatus,
      };
    }
    if (publicationStatus === "scheduled") {
      input.scheduled_for = new Date(scheduledFor).toISOString();
    }

    let uploadedMediaIds: string[] = [];
    setUploadingMedia(true);
    try {
      uploadedMediaIds = await uploadPostImages(
        selectedMedia.map((item) => item.file),
      );
      if (
        uploadedMediaIds.length > 0 ||
        retainedMedia.length !== (post.media ?? []).length
      ) {
        input.media_ids = [
          ...retainedMedia.map((item) => item.id),
          ...uploadedMediaIds,
        ];
      }
      await onSave(input);
      revokeSelectedPostImages(selectedMedia);
      selectedMediaRef.current = [];
    } catch {
      if (uploadedMediaIds.length > 0) {
        await Promise.allSettled(uploadedMediaIds.map(deleteMediaUpload));
      }
    } finally {
      setUploadingMedia(false);
    }
  }

  const titleRequired =
    post.category === "news" ||
    post.category === "lost_found" ||
    post.category === "marketplace";
  const editorBusy = busy || uploadingMedia;

  return (
    <form className="my-content-editor" onSubmit={submit}>
      <label>
        <span>
          标题 <small>{titleRequired ? "必填" : "选填"}</small>
        </span>
        <input
          defaultValue={post.title ?? ""}
          maxLength={200}
          name="title"
          required={titleRequired}
        />
      </label>
      <label>
        <span>正文</span>
        <textarea
          defaultValue={post.content}
          maxLength={10_000}
          name="content"
          required
          rows={5}
        />
      </label>
      {post.category === "lost_found" ? (
        <div className="my-content-lost-fields">
          <fieldset>
            <legend>失物类型</legend>
            <div className="mini-segmented-control">
              <button
                aria-pressed={lostFoundType === "lost"}
                onClick={() => setLostFoundType("lost")}
                type="button"
              >
                寻找物品
              </button>
              <button
                aria-pressed={lostFoundType === "found"}
                onClick={() => setLostFoundType("found")}
                type="button"
              >
                拾到物品
              </button>
            </div>
          </fieldset>
          <label>
            <span>物品分类</span>
            <select
              onChange={(event) =>
                setItemCategory(event.target.value as LostFoundCategory)
              }
              value={itemCategory}
            >
              {LOST_FOUND_CATEGORIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>地点</span>
            <input
              defaultValue={post.location ?? ""}
              maxLength={200}
              name="location"
              required
            />
          </label>
          <label>
            <span>丢失 / 拾获时间</span>
            <input
              max={toDateTimeLocal(new Date())}
              onChange={(event) => setOccurredAt(event.target.value)}
              required
              type="datetime-local"
              value={occurredAt}
            />
          </label>
        </div>
      ) : null}
      {post.category === "marketplace" ? (
        <div className="my-content-marketplace-fields">
          <div className="marketplace-safety-note">
            <strong>编辑商品信息</strong>
            <p>如已成交请及时标记“已售出”；下架后可在这里重新设为“可交易”。</p>
          </div>
          <label>
            <span>商品分类</span>
            <select
              onChange={(event) =>
                setMarketplaceCategory(
                  event.target.value as MarketplaceCategory,
                )
              }
              value={marketplaceCategory}
            >
              {MARKETPLACE_CATEGORIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>成色</span>
            <select
              onChange={(event) =>
                setMarketplaceCondition(
                  event.target.value as MarketplaceCondition,
                )
              }
              value={marketplaceCondition}
            >
              {MARKETPLACE_CONDITIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>售价（元）</span>
            <input
              inputMode="decimal"
              max="100000"
              min="0"
              onChange={(event) => setMarketplacePrice(event.target.value)}
              required
              step="0.01"
              type="number"
              value={marketplacePrice}
            />
          </label>
          <label>
            <span>购入原价（元，选填）</span>
            <input
              inputMode="decimal"
              max="100000"
              min="0"
              onChange={(event) =>
                setMarketplaceOriginalPrice(event.target.value)
              }
              step="0.01"
              type="number"
              value={marketplaceOriginalPrice}
            />
          </label>
          <label>
            <span>交易方式</span>
            <select
              onChange={(event) =>
                setMarketplaceTradeMethod(
                  event.target.value as MarketplaceTradeMethod,
                )
              }
              value={marketplaceTradeMethod}
            >
              {MARKETPLACE_TRADE_METHODS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>校内面交地点</span>
            <input
              maxLength={200}
              onChange={(event) => setMarketplaceLocation(event.target.value)}
              required
              value={marketplaceLocation}
            />
          </label>
          <label>
            <span>交易状态</span>
            <select
              onChange={(event) =>
                setMarketplaceStatus(event.target.value as MarketplaceStatus)
              }
              value={marketplaceStatus}
            >
              {MARKETPLACE_STATUSES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="marketplace-editor-check">
            <input
              checked={marketplaceNegotiable}
              onChange={(event) =>
                setMarketplaceNegotiable(event.target.checked)
              }
              type="checkbox"
            />
            价格可小幅商议
          </label>
        </div>
      ) : null}
      <label>
        <span>
          标签 <small>最多 8 个，以空格或逗号分隔</small>
        </span>
        <input defaultValue={post.tags.join(" ")} name="tags" />
      </label>
      <section className="my-content-media-editor">
        {retainedMedia.length > 0 ? (
          <div className="my-content-media-existing">
            {retainedMedia.map((item, index) => (
              <figure key={item.id}>
                <img
                  alt={`${post.title ?? "校园便笺"}的第 ${index + 1} 张图片`}
                  height={item.pixel_height}
                  src={item.url}
                  width={item.pixel_width}
                />
                <button
                  aria-label={`移除第 ${index + 1} 张图片`}
                  disabled={editorBusy}
                  onClick={() =>
                    setRetainedMedia((current) =>
                      current.filter((media) => media.id !== item.id),
                    )
                  }
                  type="button"
                >
                  移除
                </button>
              </figure>
            ))}
          </div>
        ) : null}
        <MediaPicker
          disabled={editorBusy}
          existingCount={retainedMedia.length}
          items={selectedMedia}
          onChange={setSelectedMedia}
        />
      </section>
      <fieldset>
        <legend>发布状态</legend>
        <div className="publication-options">
          {(
            [
              ["published", "立即发布"],
              ["draft", "保存草稿"],
              ["scheduled", "定时发布"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={publicationStatus === value}
              key={value}
              onClick={() => setPublicationStatus(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {publicationStatus === "scheduled" ? (
        <label>
          <span>计划发布时间</span>
          <input
            onChange={(event) => setScheduledFor(event.target.value)}
            onFocus={(event) => {
              event.currentTarget.min = toDateTimeLocal(
                new Date(Date.now() + 60_000),
              );
            }}
            required
            type="datetime-local"
            value={scheduledFor}
          />
        </label>
      ) : null}
      <div className="my-content-editor-checks">
        <label>
          <input
            checked={isAnonymous}
            disabled={post.category === "marketplace"}
            onChange={(event) => setIsAnonymous(event.target.checked)}
            type="checkbox"
          />
          {post.category === "marketplace" ? "交易卖家需显示昵称" : "匿名展示"}
        </label>
        <label>
          <input
            checked={commentsEnabled}
            onChange={(event) => setCommentsEnabled(event.target.checked)}
            type="checkbox"
          />
          允许评论
        </label>
      </div>
      {validationError ? (
        <p className="auth-error" role="alert">
          {validationError}
        </p>
      ) : null}
      <div className="my-content-editor-actions">
        <button disabled={editorBusy} onClick={onCancel} type="button">
          取消
        </button>
        <button className="primary-button" disabled={editorBusy} type="submit">
          {uploadingMedia ? "正在上传…" : busy ? "正在保存…" : "保存修改"}
        </button>
      </div>
    </form>
  );
}

export function MyContentPanel({ onContentChanged }: MyContentPanelProps) {
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPosts(await fetchMyPosts());
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchMyPosts()
      .then((nextPosts) => {
        if (active) setPosts(nextPosts);
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

  const visiblePosts = useMemo(
    () =>
      filter === "all"
        ? posts
        : posts.filter(
            (post) => (post.publication_status ?? "published") === filter,
          ),
    [filter, posts],
  );

  const counts = useMemo(
    () =>
      posts.reduce<Record<ContentFilter, number>>(
        (result, post) => {
          const status = post.publication_status ?? "published";
          result.all += 1;
          result[status] += 1;
          return result;
        },
        { all: 0, draft: 0, scheduled: 0, published: 0 },
      ),
    [posts],
  );

  async function savePost(postId: string, input: UpdatePostInput) {
    if (postId === "17") {
      // #region agent log
      debugClientLog({
        hypothesisId: "H1",
        location: "my-content-panel.tsx:savePost(entry)",
        message: "savePost entered for watched post",
        data: {
          postId,
          requestedStatus: input.marketplace?.status ?? null,
        },
        timestamp: Date.now(),
      });
      // #endregion
    }
    setBusyId(postId);
    setError("");
    setMessage("");
    try {
      const saved = await updatePost(postId, input);
      if (postId === "17") {
        // #region agent log
        debugClientLog({
          hypothesisId: "H4",
          location: "my-content-panel.tsx:savePost(patch-resolved)",
          message: "PATCH resolved for watched post",
          data: {
            postId,
            returnedStatus: saved.marketplace?.status ?? null,
          },
          timestamp: Date.now(),
        });
        // #endregion
      }
      setPosts((current) =>
        current.map((post) => (post.id === postId ? saved : post)),
      );
      setEditingId(null);
      setMessage("内容与发布设置已保存。");
      if (postId === "17") {
        // #region agent log
        debugClientLog({
          hypothesisId: "H1",
          location: "my-content-panel.tsx:savePost(callback)",
          message: "dispatching onContentChanged",
          data: { postId },
          timestamp: Date.now(),
        });
        // #endregion
      }
      onContentChanged();
    } catch (saveError) {
      setError(readableError(saveError));
      throw saveError;
    } finally {
      setBusyId(null);
    }
  }

  async function removePost(post: WallPost) {
    if (
      !window.confirm(
        `确认删除“${post.title ?? "无标题便笺"}”？删除后无法自行恢复。`,
      )
    ) {
      return;
    }
    setBusyId(post.id);
    setError("");
    setMessage("");
    try {
      await deletePost(post.id);
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setEditingId(null);
      setMessage("内容已删除。");
      onContentChanged();
    } catch (removeError) {
      setError(readableError(removeError));
    } finally {
      setBusyId(null);
    }
  }

  const filters: { id: ContentFilter; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "draft", label: "草稿" },
    { id: "scheduled", label: "定时" },
    { id: "published", label: "已发布" },
  ];

  return (
    <section className="my-content-panel">
      <div className="account-section-heading my-content-heading">
        <div>
          <h3>我的内容</h3>
          <p>管理草稿、定时发布、评论权限和已经公开的便笺。</p>
        </div>
        <button
          disabled={loading}
          onClick={() => void loadPosts()}
          type="button"
        >
          {loading ? "同步中…" : "刷新"}
        </button>
      </div>

      <div
        aria-label="按发布状态筛选"
        className="my-content-filters"
        role="tablist"
      >
        {filters.map((item) => (
          <button
            aria-selected={filter === item.id}
            key={item.id}
            onClick={() => setFilter(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
            <span>{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {loading ? <p className="account-loading">正在整理你的便笺…</p> : null}
      {!loading && visiblePosts.length === 0 ? (
        <div className="my-content-empty">
          <strong>
            {filter === "all" ? "还没有发布记录" : "这个分类还是空的"}
          </strong>
          <p>新建便笺后，可以在这里继续编辑或调整发布时间。</p>
        </div>
      ) : null}

      {!loading && visiblePosts.length > 0 ? (
        <div className="my-content-list">
          {visiblePosts.map((post) => {
            const status = post.publication_status ?? "published";
            const editing = editingId === post.id;
            return (
              <article
                className="my-content-card"
                data-status={status}
                key={post.id}
              >
                <div className="my-content-card-top">
                  <div>
                    <span className="content-status">
                      {STATUS_LABELS[status]}
                    </span>
                    <small>{getBoard(post.category).name}</small>
                  </div>
                  <time dateTime={post.created_at}>
                    {formatDate(post.created_at)}
                  </time>
                </div>
                <h4>{post.title ?? "无标题便笺"}</h4>
                <p>{post.content}</p>
                {post.marketplace ? (
                  <div className="my-content-marketplace-summary">
                    <strong>
                      {formatMarketplacePrice(post.marketplace.price_cents)}
                    </strong>
                    <span data-status={post.marketplace.status}>
                      {
                        MARKETPLACE_STATUSES.find(
                          (item) => item.id === post.marketplace?.status,
                        )?.label
                      }
                    </span>
                    <small>{post.marketplace.meetup_location}</small>
                  </div>
                ) : null}
                {(post.media ?? []).length > 0 ? (
                  <div className="my-content-media-strip">
                    {(post.media ?? []).map((item, index) => (
                      <img
                        alt={`${post.title ?? "校园便笺"}的第 ${index + 1} 张图片`}
                        key={item.id}
                        height={item.pixel_height}
                        loading="lazy"
                        src={item.url}
                        width={item.pixel_width}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="my-content-meta">
                  <span>
                    {post.comments_enabled === false
                      ? "评论已关闭"
                      : "允许评论"}
                  </span>
                  <span>{post.comment_count} 条评论</span>
                  {(post.media ?? []).length > 0 ? (
                    <span>{(post.media ?? []).length} 张图片</span>
                  ) : null}
                  {post.category === "lost_found" && post.item_category ? (
                    <span>
                      {
                        LOST_FOUND_CATEGORIES.find(
                          (item) => item.id === post.item_category,
                        )?.label
                      }
                    </span>
                  ) : null}
                  {post.category === "lost_found" && post.occurred_at ? (
                    <span>发生于 {formatDate(post.occurred_at)}</span>
                  ) : null}
                  {post.marketplace ? (
                    <span>
                      {
                        MARKETPLACE_CATEGORIES.find(
                          (item) => item.id === post.marketplace?.category,
                        )?.label
                      }
                    </span>
                  ) : null}
                  {status === "scheduled" && post.scheduled_for ? (
                    <span>计划于 {formatDate(post.scheduled_for)}</span>
                  ) : null}
                </div>
                {post.can_edit !== false ? (
                  <div className="my-content-card-actions">
                    <button
                      disabled={busyId === post.id}
                      onClick={() =>
                        setEditingId((current) =>
                          current === post.id ? null : post.id,
                        )
                      }
                      type="button"
                    >
                      {editing ? "收起编辑" : "编辑"}
                    </button>
                    <button
                      className="danger-action"
                      disabled={busyId === post.id}
                      onClick={() => void removePost(post)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                ) : null}
                {editing ? (
                  <PostEditor
                    busy={busyId === post.id}
                    onCancel={() => setEditingId(null)}
                    onSave={(input) => savePost(post.id, input)}
                    post={post}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

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
    </section>
  );
}
