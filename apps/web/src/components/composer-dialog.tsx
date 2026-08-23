import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";

import { BoardIcon, CloseIcon, SendIcon } from "@/components/icons";
import {
  MediaPicker,
  revokeSelectedPostImages,
  type SelectedPostImage,
} from "@/components/media-picker";
import { ApiError, deleteMediaUpload, uploadPostImages } from "@/lib/api";
import {
  BOARDS,
  LOST_FOUND_CATEGORIES,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CONDITIONS,
  MARKETPLACE_TRADE_METHODS,
  yuanToCents,
  type BoardId,
  type CreatePostInput,
  type LostFoundCategory,
  type LostFoundKind,
  type MarketplaceCategory,
  type MarketplaceCondition,
  type MarketplaceTradeMethod,
  type PublicationStatus,
} from "@/lib/campus-wall";

type ComposerDialogProps = {
  initialBoard: BoardId;
  onClose: () => void;
  onSubmit: (input: CreatePostInput) => Promise<void>;
};

function minimumScheduleValue(): string {
  const minimum = new Date(Date.now() + 60_000);
  minimum.setMinutes(minimum.getMinutes() - minimum.getTimezoneOffset());
  return minimum.toISOString().slice(0, 16);
}

function currentLocalDateTimeValue(): string {
  const current = new Date();
  current.setMinutes(current.getMinutes() - current.getTimezoneOffset());
  return current.toISOString().slice(0, 16);
}

export function ComposerDialog({
  initialBoard,
  onClose,
  onSubmit,
}: ComposerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedMediaRef = useRef<SelectedPostImage[]>([]);
  const [category, setCategory] = useState<BoardId>(initialBoard);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagText, setTagText] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(
    initialBoard === "tree_hole" || initialBoard === "confession",
  );
  const [location, setLocation] = useState("");
  const [lostFoundType, setLostFoundType] = useState<LostFoundKind>("lost");
  const [itemCategory, setItemCategory] = useState<LostFoundCategory>("other");
  const [occurredAt, setOccurredAt] = useState("");
  const [marketplaceCategory, setMarketplaceCategory] =
    useState<MarketplaceCategory>("books");
  const [marketplaceCondition, setMarketplaceCondition] =
    useState<MarketplaceCondition>("good");
  const [marketplacePrice, setMarketplacePrice] = useState("");
  const [marketplaceOriginalPrice, setMarketplaceOriginalPrice] = useState("");
  const [marketplaceNegotiable, setMarketplaceNegotiable] = useState(false);
  const [marketplaceTradeMethod, setMarketplaceTradeMethod] =
    useState<MarketplaceTradeMethod>("campus_meetup");
  const [marketplaceLocation, setMarketplaceLocation] = useState("");
  const [publicationStatus, setPublicationStatus] =
    useState<PublicationStatus>("published");
  const [scheduledFor, setScheduledFor] = useState("");
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<SelectedPostImage[]>([]);
  const [submissionError, setSubmissionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
      revokeSelectedPostImages(selectedMediaRef.current);
    };
  }, []);

  useEffect(() => {
    selectedMediaRef.current = selectedMedia;
  }, [selectedMedia]);

  function selectCategory(nextCategory: BoardId) {
    setCategory(nextCategory);
    if (nextCategory === "tree_hole" || nextCategory === "confession") {
      setIsAnonymous(true);
    } else if (nextCategory === "marketplace") {
      setIsAnonymous(false);
    }
  }

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget && !isSubmitting) {
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanContent = content.trim();

    if (!cleanContent) {
      return;
    }

    const marketplacePriceCents =
      category === "marketplace" ? yuanToCents(marketplacePrice) : null;
    const marketplaceOriginalPriceCents =
      category === "marketplace" && marketplaceOriginalPrice.trim()
        ? yuanToCents(marketplaceOriginalPrice)
        : null;
    if (
      category === "marketplace" &&
      (marketplacePriceCents === null ||
        (marketplaceOriginalPrice.trim() &&
          marketplaceOriginalPriceCents === null))
    ) {
      setSubmissionError("请填写有效价格，最多保留两位小数。");
      return;
    }
    if (
      category === "marketplace" &&
      marketplacePriceCents !== null &&
      marketplaceOriginalPriceCents !== null &&
      marketplaceOriginalPriceCents < marketplacePriceCents
    ) {
      setSubmissionError("原价不能低于当前售价。");
      return;
    }

    setIsSubmitting(true);
    setSubmissionError("");
    let uploadedMediaIds: string[] = [];
    try {
      uploadedMediaIds = await uploadPostImages(
        selectedMedia.map((item) => item.file),
      );
      await onSubmit({
        category,
        title: title.trim() || undefined,
        content: cleanContent,
        tags: tagText
          .split(/[，,\s]+/)
          .map((tag) => tag.replace(/^#/, "").trim())
          .filter(Boolean)
          .slice(0, 5),
        is_anonymous: category === "marketplace" ? false : isAnonymous,
        location:
          category === "lost_found" ? location.trim() || undefined : undefined,
        lost_found_type: category === "lost_found" ? lostFoundType : undefined,
        item_category: category === "lost_found" ? itemCategory : undefined,
        occurred_at:
          category === "lost_found"
            ? new Date(occurredAt).toISOString()
            : undefined,
        resolution_status: category === "lost_found" ? "open" : undefined,
        publication_status: publicationStatus,
        scheduled_for:
          publicationStatus === "scheduled"
            ? new Date(scheduledFor).toISOString()
            : undefined,
        comments_enabled: commentsEnabled,
        media_ids: uploadedMediaIds,
        marketplace:
          category === "marketplace" && marketplacePriceCents !== null
            ? {
                category: marketplaceCategory,
                condition: marketplaceCondition,
                price_cents: marketplacePriceCents,
                original_price_cents: marketplaceOriginalPriceCents,
                negotiable: marketplaceNegotiable,
                trade_method: marketplaceTradeMethod,
                meetup_location: marketplaceLocation.trim(),
              }
            : undefined,
      });
      revokeSelectedPostImages(selectedMedia);
      selectedMediaRef.current = [];
      setIsSubmitting(false);
      onClose();
    } catch (error) {
      if (uploadedMediaIds.length > 0) {
        await Promise.allSettled(uploadedMediaIds.map(deleteMediaUpload));
      }
      setSubmissionError(
        error instanceof ApiError
          ? error.message
          : "便笺没有保存成功，请检查网络后重试。",
      );
      setIsSubmitting(false);
    }
  }

  const needsTitle =
    category === "news" ||
    category === "lost_found" ||
    category === "marketplace";

  return (
    <dialog
      aria-labelledby="composer-title"
      className="composer-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      onClick={handleBackdropClick}
      ref={dialogRef}
    >
      <section className="composer-sheet">
        <header className="composer-header">
          <div>
            <span className="eyebrow">PIN A NEW NOTE</span>
            <h2 id="composer-title">写一张校园便笺</h2>
            <p>选择合适的板块，让这条消息更快遇见对的人。</p>
          </div>
          <button
            aria-label="关闭发布窗口"
            className="icon-button"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            <CloseIcon size={20} />
          </button>
        </header>

        <form className="composer-form" onSubmit={handleSubmit}>
          <fieldset className="composer-board-fieldset">
            <legend>发布到</legend>
            <div aria-label="选择发布板块" className="composer-board-grid">
              {BOARDS.map((board) => (
                <button
                  aria-pressed={category === board.id}
                  className="composer-board-option"
                  data-active={category === board.id}
                  data-board={board.id}
                  key={board.id}
                  onClick={() => selectCategory(board.id)}
                  type="button"
                >
                  <BoardIcon board={board.id} size={18} />
                  <span>{board.shortName}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="form-field">
            <span>
              标题
              <small>{needsTitle ? "必填" : "选填"}</small>
            </span>
            <input
              autoFocus
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                category === "tree_hole"
                  ? "可以不给心事加标题"
                  : "一句话说清这张便笺"
              }
              required={needsTitle}
              value={title}
            />
          </label>

          <fieldset className="segmented-fieldset publication-fieldset">
            <legend>发布方式</legend>
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
            <label className="form-field">
              <span>计划发布时间</span>
              <input
                onChange={(event) => setScheduledFor(event.target.value)}
                onFocus={(event) => {
                  event.currentTarget.min = minimumScheduleValue();
                }}
                required
                type="datetime-local"
                value={scheduledFor}
              />
            </label>
          ) : null}

          <label className="form-field">
            <span>
              正文
              <small>{content.length}/600</small>
            </span>
            <textarea
              maxLength={600}
              onChange={(event) => setContent(event.target.value)}
              placeholder="把时间、地点或想说的话写具体一些……"
              required
              rows={6}
              value={content}
            />
          </label>

          {category === "lost_found" ? (
            <div className="lost-found-fields">
              <fieldset className="segmented-fieldset">
                <legend>类型</legend>
                <div className="mini-segmented-control">
                  <button
                    aria-pressed={lostFoundType === "lost"}
                    onClick={() => setLostFoundType("lost")}
                    type="button"
                  >
                    我丢了东西
                  </button>
                  <button
                    aria-pressed={lostFoundType === "found"}
                    onClick={() => setLostFoundType("found")}
                    type="button"
                  >
                    我捡到东西
                  </button>
                </div>
              </fieldset>
              <label className="form-field compact-field">
                <span>地点</span>
                <input
                  maxLength={80}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="例如：三教 201"
                  required
                  value={location}
                />
              </label>
              <label className="form-field compact-field">
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
              <label className="form-field compact-field">
                <span>丢失 / 拾获时间</span>
                <input
                  max={currentLocalDateTimeValue()}
                  onChange={(event) => setOccurredAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={occurredAt}
                />
              </label>
            </div>
          ) : null}

          {category === "marketplace" ? (
            <section aria-label="二手商品信息" className="marketplace-fields">
              <div className="marketplace-safety-note">
                <strong>仅限校内闲置物品</strong>
                <p>
                  禁止发布证件卡、账号、烟酒药品等受限物品；请当面验货，不要提前站外付款。
                </p>
              </div>
              <label className="form-field compact-field">
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
              <label className="form-field compact-field">
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
              <label className="form-field compact-field">
                <span>售价（元）</span>
                <input
                  inputMode="decimal"
                  max="100000"
                  min="0"
                  onChange={(event) => setMarketplacePrice(event.target.value)}
                  placeholder="例如：28"
                  required
                  step="0.01"
                  type="number"
                  value={marketplacePrice}
                />
              </label>
              <label className="form-field compact-field">
                <span>
                  购入原价（元）<small>选填</small>
                </span>
                <input
                  inputMode="decimal"
                  max="100000"
                  min="0"
                  onChange={(event) =>
                    setMarketplaceOriginalPrice(event.target.value)
                  }
                  placeholder="用于帮助买家判断折价"
                  step="0.01"
                  type="number"
                  value={marketplaceOriginalPrice}
                />
              </label>
              <label className="form-field compact-field">
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
              <label className="form-field compact-field">
                <span>校内面交地点</span>
                <input
                  maxLength={200}
                  onChange={(event) =>
                    setMarketplaceLocation(event.target.value)
                  }
                  placeholder="例如：图书馆一楼大厅"
                  required
                  value={marketplaceLocation}
                />
              </label>
              <label className="check-field marketplace-negotiable">
                <input
                  checked={marketplaceNegotiable}
                  onChange={(event) =>
                    setMarketplaceNegotiable(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>价格可小幅商议</span>
              </label>
            </section>
          ) : null}

          <label className="form-field">
            <span>
              标签
              <small>最多 5 个</small>
            </span>
            <input
              maxLength={80}
              onChange={(event) => setTagText(event.target.value)}
              placeholder="用空格或逗号分隔，例如：社团招新 周四"
              value={tagText}
            />
          </label>

          <MediaPicker
            disabled={isSubmitting}
            items={selectedMedia}
            onChange={setSelectedMedia}
          />

          {submissionError ? (
            <p className="auth-error" role="alert">
              {submissionError}
            </p>
          ) : null}

          <footer className="composer-footer">
            <div className="composer-options">
              <label className="check-field">
                <input
                  checked={isAnonymous}
                  disabled={category === "marketplace"}
                  onChange={(event) => setIsAnonymous(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  {category === "marketplace"
                    ? "交易卖家需显示昵称"
                    : "匿名发布"}
                </span>
              </label>
              <label className="check-field">
                <input
                  checked={commentsEnabled}
                  onChange={(event) => setCommentsEnabled(event.target.checked)}
                  type="checkbox"
                />
                <span>允许评论</span>
              </label>
            </div>
            <button
              className="primary-button composer-submit"
              disabled={isSubmitting}
              type="submit"
            >
              <SendIcon size={18} />
              {isSubmitting
                ? selectedMedia.length > 0
                  ? "正在上传并保存…"
                  : "正在保存…"
                : publicationStatus === "draft"
                  ? "保存草稿"
                  : publicationStatus === "scheduled"
                    ? "安排发布"
                    : "贴上校园墙"}
            </button>
          </footer>
        </form>
      </section>
    </dialog>
  );
}
