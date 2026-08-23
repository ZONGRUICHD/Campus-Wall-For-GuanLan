import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";

import { BoardIcon, CloseIcon, SendIcon } from "@/components/icons";
import { ApiError } from "@/lib/api";
import {
  BOARDS,
  type BoardId,
  type CreatePostInput,
  type LostFoundKind,
  type PublicationStatus,
} from "@/lib/campus-wall";

type ComposerDialogProps = {
  initialBoard: BoardId;
  onClose: () => void;
  onSubmit: (input: CreatePostInput) => Promise<void>;
};

export function ComposerDialog({
  initialBoard,
  onClose,
  onSubmit,
}: ComposerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState<BoardId>(initialBoard);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagText, setTagText] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(
    initialBoard === "tree_hole" || initialBoard === "confession",
  );
  const [location, setLocation] = useState("");
  const [lostFoundType, setLostFoundType] = useState<LostFoundKind>("lost");
  const [publicationStatus, setPublicationStatus] =
    useState<PublicationStatus>("published");
  const [scheduledFor, setScheduledFor] = useState("");
  const [scheduleMinimum, setScheduleMinimum] = useState("");
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [submissionError, setSubmissionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const minimum = new Date(Date.now() + 60_000);
    minimum.setMinutes(minimum.getMinutes() - minimum.getTimezoneOffset());
    setScheduleMinimum(minimum.toISOString().slice(0, 16));

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  function selectCategory(nextCategory: BoardId) {
    setCategory(nextCategory);
    if (nextCategory === "tree_hole" || nextCategory === "confession") {
      setIsAnonymous(true);
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

    setIsSubmitting(true);
    setSubmissionError("");
    try {
      await onSubmit({
        category,
        title: title.trim() || undefined,
        content: cleanContent,
        tags: tagText
          .split(/[，,\s]+/)
          .map((tag) => tag.replace(/^#/, "").trim())
          .filter(Boolean)
          .slice(0, 5),
        is_anonymous: isAnonymous,
        location:
          category === "lost_found" ? location.trim() || undefined : undefined,
        lost_found_type: category === "lost_found" ? lostFoundType : undefined,
        resolution_status: category === "lost_found" ? "open" : undefined,
        publication_status: publicationStatus,
        scheduled_for:
          publicationStatus === "scheduled"
            ? new Date(scheduledFor).toISOString()
            : undefined,
        comments_enabled: commentsEnabled,
      });
      setIsSubmitting(false);
      onClose();
    } catch (error) {
      setSubmissionError(
        error instanceof ApiError
          ? error.message
          : "便笺没有保存成功，请检查网络后重试。",
      );
      setIsSubmitting(false);
    }
  }

  const needsTitle = category === "news" || category === "lost_found";

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
                min={scheduleMinimum || undefined}
                onChange={(event) => setScheduledFor(event.target.value)}
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
                  value={location}
                />
              </label>
            </div>
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
                  onChange={(event) => setIsAnonymous(event.target.checked)}
                  type="checkbox"
                />
                <span>匿名发布</span>
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
            <button className="primary-button composer-submit" disabled={isSubmitting} type="submit">
              <SendIcon size={18} />
              {isSubmitting
                ? "正在保存…"
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

