/* User media has runtime URLs, so static-exported pages use native images. */
/* eslint-disable @next/next/no-img-element */

import { useId, useState, type FormEvent } from "react";

import {
  CheckIcon,
  CommentIcon,
  HeartIcon,
  LocationIcon,
  MoreIcon,
  PinIcon,
  SendIcon,
} from "@/components/icons";
import { LostFoundClaimsPanel } from "@/components/lost-found-claims-panel";
import {
  getBoard,
  LOST_FOUND_CATEGORIES,
  type ResolutionStatus,
  type WallPost,
} from "@/lib/campus-wall";

type PostCardProps = {
  claimsAvailable: boolean;
  post: WallPost;
  onBookmark: (postId: string) => Promise<void>;
  onLike: (postId: string) => Promise<void>;
  onComment: (
    postId: string,
    content: string,
    isAnonymous: boolean,
    parentId?: string,
  ) => Promise<void>;
  onCommentDelete: (postId: string, commentId: string) => Promise<void>;
  onCommentEdit: (
    postId: string,
    commentId: string,
    content: string,
  ) => Promise<void>;
  onCommentLike: (postId: string, commentId: string) => Promise<void>;
  onClaimAccepted: (postId: string) => void;
  onReport: (postId: string, title: string) => void;
  onResolutionChange: (
    postId: string,
    resolutionStatus: ResolutionStatus,
  ) => Promise<void>;
};

function formatPostTime(post: WallPost): string {
  if (post.time_label) return post.time_label;

  const parsed = new Date(post.created_at);
  if (Number.isNaN(parsed.getTime())) return "刚刚";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function avatarText(post: WallPost): string {
  if (post.category === "tree_hole") return "树";
  if (post.is_anonymous) return "匿";
  return post.author_name.trim().slice(0, 1) || "观";
}

function formatOccurrenceTime(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function PostCard({
  claimsAvailable,
  post,
  onBookmark,
  onLike,
  onComment,
  onCommentDelete,
  onCommentEdit,
  onCommentLike,
  onClaimAccepted,
  onReport,
  onResolutionChange,
}: PostCardProps) {
  const commentsId = useId();
  const claimsId = useId();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentAnonymously, setCommentAnonymously] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);
  const [replyTo, setReplyTo] = useState<{
    id: string;
    authorName: string;
  } | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [commentMutationId, setCommentMutationId] = useState<string | null>(
    null,
  );
  const board = getBoard(post.category);
  const itemCategoryLabel = LOST_FOUND_CATEGORIES.find(
    (item) => item.id === post.item_category,
  )?.label;
  const occurrenceTime = formatOccurrenceTime(post.occurred_at);
  const media = post.media ?? [];

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanComment = commentText.trim();
    if (!cleanComment) return;

    setIsCommenting(true);
    await onComment(
      post.id,
      cleanComment,
      commentAnonymously,
      replyTo?.id,
    );
    setCommentText("");
    setReplyTo(null);
    setIsCommenting(false);
  }

  async function submitCommentEdit(
    event: FormEvent<HTMLFormElement>,
    commentId: string,
  ) {
    event.preventDefault();
    const cleanComment = editingCommentText.trim();
    if (!cleanComment) return;
    setCommentMutationId(commentId);
    try {
      await onCommentEdit(post.id, commentId, cleanComment);
      setEditingCommentId(null);
      setEditingCommentText("");
    } catch {
      return;
    } finally {
      setCommentMutationId(null);
    }
  }

  async function removeComment(commentId: string) {
    if (!window.confirm("确认删除这条评论？删除后无法自行恢复。")) return;
    setCommentMutationId(commentId);
    try {
      await onCommentDelete(post.id, commentId);
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditingCommentText("");
      }
    } catch {
      return;
    } finally {
      setCommentMutationId(null);
    }
  }

  const resolutionStatus = post.resolution_status ?? "open";
  const nextResolutionStatus: ResolutionStatus =
    resolutionStatus === "open" ? "resolved" : "open";

  return (
    <article className="post-card" data-board={post.category}>
      <div className="post-card-accent" />
      <header className="post-author-row">
        <div className="post-avatar" data-board={post.category}>
          {avatarText(post)}
        </div>
        <div className="post-author-copy">
          <div className="post-author-name">
            <strong>{post.author_name}</strong>
            {post.author_badge ? <span>{post.author_badge}</span> : null}
          </div>
          <div className="post-meta-line">
            <span>{formatPostTime(post)}</span>
            <span aria-hidden="true">·</span>
            <span>{board.name}</span>
          </div>
        </div>
        {post.is_pinned ? (
          <span className="pinned-label">
            <PinIcon size={15} />
            置顶
          </span>
        ) : null}
      </header>

      <div className="post-content">
        {post.category === "lost_found" ? (
          <div className="lost-found-badges">
            <span className="item-kind-badge">
              {post.lost_found_type === "found" ? "拾到物品" : "寻找物品"}
            </span>
            {itemCategoryLabel ? (
              <span className="item-category-badge">{itemCategoryLabel}</span>
            ) : null}
            <span className="resolution-badge" data-status={resolutionStatus}>
              {resolutionStatus === "resolved" ? "已解决" : "进行中"}
            </span>
          </div>
        ) : null}

        {post.title ? <h2>{post.title}</h2> : null}
        <p>{post.content}</p>
        {media.length > 0 ? (
          <div className="post-media-grid" data-count={media.length}>
            {media.map((item, index) => (
              <a
                aria-label={`查看${post.title ?? "这条便笺"}的第 ${index + 1} 张图片`}
                href={item.url}
                key={item.id}
                rel="noreferrer"
                target="_blank"
              >
                <img
                  alt={`${post.title ?? "校园便笺"}的第 ${index + 1} 张图片`}
                  decoding="async"
                  loading="lazy"
                  src={item.url}
                />
              </a>
            ))}
          </div>
        ) : null}

        {post.location ? (
          <div className="post-location">
            <LocationIcon size={16} />
            <span>{post.location}</span>
          </div>
        ) : null}
        {occurrenceTime ? (
          <div className="post-occurrence">
            <span>发生时间</span>
            <time dateTime={post.occurred_at}>{occurrenceTime}</time>
          </div>
        ) : null}

        {post.tags.length > 0 ? (
          <div aria-label="帖子标签" className="post-tags">
            {post.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="post-actions">
        <div className="post-action-group">
          <button
            aria-label={post.liked ? `取消点赞，当前 ${post.likes_count} 个赞` : `点赞，当前 ${post.likes_count} 个赞`}
            aria-pressed={post.liked}
            className="post-action-button"
            data-liked={post.liked}
            onClick={() => void onLike(post.id)}
            type="button"
          >
            <HeartIcon filled={post.liked} size={19} />
            <span>{post.likes_count}</span>
          </button>
          <button
            aria-label={post.bookmarked ? "取消收藏" : "收藏帖子"}
            aria-pressed={post.bookmarked}
            className="post-action-button"
            data-bookmarked={post.bookmarked}
            onClick={() => void onBookmark(post.id)}
            type="button"
          >
            <PinIcon size={17} />
            <span className="action-word">
              {post.bookmarked ? "已收藏" : "收藏"}
            </span>
          </button>
          <button
            aria-controls={commentsId}
            aria-expanded={commentsOpen}
            className="post-action-button"
            onClick={() => setCommentsOpen((current) => !current)}
            type="button"
          >
            <CommentIcon size={19} />
            <span>{post.comment_count}</span>
            <span className="action-word">评论</span>
          </button>
        </div>

        <div className="post-card-secondary-actions">
          {post.category === "lost_found" && claimsAvailable ? (
            <button
              aria-controls={claimsId}
              aria-expanded={claimsOpen}
              className="claim-action"
              onClick={() => setClaimsOpen((current) => !current)}
              type="button"
            >
              {post.can_edit
                ? "管理认领"
                : resolutionStatus === "resolved"
                  ? "查看线索"
                  : "提交线索"}
            </button>
          ) : null}
          <button
            className="post-action-button report-action"
            onClick={() => onReport(post.id, post.title ?? "无标题帖子")}
            type="button"
          >
            <MoreIcon size={17} />
            举报
          </button>
          {post.category === "lost_found" && post.can_edit ? (
            <button
              className="resolution-action"
              onClick={() => void onResolutionChange(post.id, nextResolutionStatus)}
              type="button"
            >
              <CheckIcon size={17} />
              {resolutionStatus === "open" ? "标记已解决" : "重新开启"}
            </button>
          ) : null}
        </div>
      </footer>

      {post.category === "lost_found" && claimsAvailable && claimsOpen ? (
        <div id={claimsId}>
          <LostFoundClaimsPanel
            canReview={post.can_edit === true}
            onResolved={() => onClaimAccepted(post.id)}
            postId={post.id}
            resolved={resolutionStatus === "resolved"}
          />
        </div>
      ) : null}

      {commentsOpen ? (
        <section aria-label={`${post.title ?? "这条帖子"}的评论`} className="comments-panel" id={commentsId}>
          {post.comments.length > 0 ? (
            <ul className="comment-list">
              {post.comments.map((comment) => (
                <li
                  className="comment-item"
                  data-depth={comment.depth ?? 0}
                  key={comment.id}
                >
                  <div className="comment-avatar">{comment.is_anonymous ? "匿" : comment.author_name.slice(0, 1)}</div>
                  <div className="comment-bubble">
                    <div>
                      <strong>{comment.author_name}</strong>
                      <time dateTime={comment.created_at}>{comment.time_label ?? "刚刚"}</time>
                      {comment.edited_at ? <small>已编辑</small> : null}
                    </div>
                    {editingCommentId === comment.id ? (
                      <form
                        className="comment-edit-form"
                        onSubmit={(event) =>
                          void submitCommentEdit(event, comment.id)
                        }
                      >
                        <input
                          autoFocus
                          disabled={commentMutationId === comment.id}
                          maxLength={10_000}
                          onChange={(event) =>
                            setEditingCommentText(event.target.value)
                          }
                          required
                          value={editingCommentText}
                        />
                        <button
                          disabled={
                            commentMutationId === comment.id ||
                            !editingCommentText.trim()
                          }
                          type="submit"
                        >
                          保存
                        </button>
                        <button
                          disabled={commentMutationId === comment.id}
                          onClick={() => setEditingCommentId(null)}
                          type="button"
                        >
                          取消
                        </button>
                      </form>
                    ) : (
                      <p>{comment.content}</p>
                    )}
                    <div className="comment-actions">
                      <button
                        aria-pressed={comment.liked}
                        data-liked={comment.liked}
                        onClick={() =>
                          void onCommentLike(post.id, comment.id)
                        }
                        type="button"
                      >
                        <HeartIcon
                          filled={comment.liked}
                          size={13}
                        />
                        {comment.likes_count ?? 0}
                      </button>
                      {(comment.depth ?? 0) < 2 ? (
                        <button
                          onClick={() =>
                            setReplyTo({
                              id: comment.id,
                              authorName: comment.author_name,
                            })
                          }
                          type="button"
                        >
                          回复
                        </button>
                      ) : null}
                      {comment.can_edit ? (
                        <>
                          <button
                            disabled={commentMutationId === comment.id}
                            onClick={() => {
                              setEditingCommentId(comment.id);
                              setEditingCommentText(comment.content);
                            }}
                            type="button"
                          >
                            编辑
                          </button>
                          <button
                            className="comment-delete-action"
                            disabled={commentMutationId === comment.id}
                            onClick={() => void removeComment(comment.id)}
                            type="button"
                          >
                            删除
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : post.comments_enabled !== false ? (
            <p className="no-comments">还没有人留言，来写第一条吧。</p>
          ) : null}

          {post.comments_enabled === false ? (
            <p className="comments-closed">作者已关闭这条帖子的评论。</p>
          ) : (
          <form className="comment-form" onSubmit={submitComment}>
            {replyTo ? (
              <div className="replying-to">
                正在回复 {replyTo.authorName}
                <button onClick={() => setReplyTo(null)} type="button">
                  取消
                </button>
              </div>
            ) : null}
            <div className="comment-input-row">
              <label className="sr-only" htmlFor={`${commentsId}-input`}>
                写评论
              </label>
              <input
                disabled={isCommenting}
                id={`${commentsId}-input`}
                maxLength={240}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder={
                  replyTo
                    ? `回复 ${replyTo.authorName}…`
                    : "写下友善、具体的回应……"
                }
                value={commentText}
              />
              <button aria-label="发布评论" disabled={isCommenting || !commentText.trim()} type="submit">
                <SendIcon size={18} />
              </button>
            </div>
            <label className="comment-anonymous-toggle">
              <input
                checked={commentAnonymously}
                disabled={isCommenting}
                onChange={(event) => setCommentAnonymously(event.target.checked)}
                type="checkbox"
              />
              匿名评论
            </label>
          </form>
          )}
        </section>
      ) : null}
    </article>
  );
}
