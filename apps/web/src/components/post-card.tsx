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
import { getBoard, type ResolutionStatus, type WallPost } from "@/lib/campus-wall";

type PostCardProps = {
  post: WallPost;
  onLike: (postId: string) => Promise<void>;
  onComment: (postId: string, content: string, isAnonymous: boolean) => Promise<void>;
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

export function PostCard({
  post,
  onLike,
  onComment,
  onReport,
  onResolutionChange,
}: PostCardProps) {
  const commentsId = useId();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentAnonymously, setCommentAnonymously] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);
  const board = getBoard(post.category);

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanComment = commentText.trim();
    if (!cleanComment) return;

    setIsCommenting(true);
    await onComment(post.id, cleanComment, commentAnonymously);
    setCommentText("");
    setIsCommenting(false);
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
            <span className="resolution-badge" data-status={resolutionStatus}>
              {resolutionStatus === "resolved" ? "已解决" : "进行中"}
            </span>
          </div>
        ) : null}

        {post.title ? <h2>{post.title}</h2> : null}
        <p>{post.content}</p>

        {post.location ? (
          <div className="post-location">
            <LocationIcon size={16} />
            <span>{post.location}</span>
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
          <button
            className="post-action-button report-action"
            onClick={() => onReport(post.id, post.title ?? "无标题帖子")}
            type="button"
          >
            <MoreIcon size={17} />
            举报
          </button>
          {post.category === "lost_found" ? (
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

      {commentsOpen ? (
        <section aria-label={`${post.title ?? "这条帖子"}的评论`} className="comments-panel" id={commentsId}>
          {post.comments.length > 0 ? (
            <ul className="comment-list">
              {post.comments.map((comment) => (
                <li className="comment-item" key={comment.id}>
                  <div className="comment-avatar">{comment.is_anonymous ? "匿" : comment.author_name.slice(0, 1)}</div>
                  <div className="comment-bubble">
                    <div>
                      <strong>{comment.author_name}</strong>
                      <time dateTime={comment.created_at}>{comment.time_label ?? "刚刚"}</time>
                    </div>
                    <p>{comment.content}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="no-comments">还没有人留言，来写第一条吧。</p>
          )}

          <form className="comment-form" onSubmit={submitComment}>
            <div className="comment-input-row">
              <label className="sr-only" htmlFor={`${commentsId}-input`}>
                写评论
              </label>
              <input
                disabled={isCommenting}
                id={`${commentsId}-input`}
                maxLength={240}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="写下友善、具体的回应……"
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
        </section>
      ) : null}
    </article>
  );
}
