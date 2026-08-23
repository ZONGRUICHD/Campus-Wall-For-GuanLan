import {
  isBoardId,
  type BoardId,
  type CreateCommentInput,
  type CreatePostInput,
  type ResolutionStatus,
  type WallComment,
  type WallPost,
} from "@/lib/campus-wall";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object"
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asId(value: unknown, fallback: string): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeComment(value: unknown, index = 0): WallComment {
  const comment = asRecord(value);
  const author = asRecord(comment.author);
  const isAnonymous = comment.anonymous === true || comment.is_anonymous === true;

  return {
    id: asId(comment.id, `api-comment-${index}`),
    content: asString(comment.body, asString(comment.content)),
    author_name: isAnonymous
      ? "匿名同学"
      : asString(comment.author_name, asString(author.name, "观澜同学")),
    is_anonymous: isAnonymous,
    created_at: asString(comment.created_at, new Date().toISOString()),
  };
}

export function normalizePost(
  value: unknown,
  index = 0,
  fallbackCategory: BoardId = "daily",
): WallPost {
  const post = asRecord(value);
  const author = asRecord(post.author);
  const reactionCounts = asRecord(post.reaction_counts);
  const rawComments = Array.isArray(post.comments) ? post.comments : [];
  const category = isBoardId(post.board)
    ? post.board
    : isBoardId(post.category)
      ? post.category
      : fallbackCategory;
  const isAnonymous = post.anonymous === true || post.is_anonymous === true;
  const rawResolution = asString(post.resolution_status);
  const rawLostFoundType = asString(post.kind, asString(post.lost_found_type));

  return {
    id: asId(post.id, `api-post-${index}`),
    category,
    title: asString(post.title) || undefined,
    content: asString(post.body, asString(post.content)),
    tags: Array.isArray(post.tags)
      ? post.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    author_name: isAnonymous
      ? category === "tree_hole"
        ? asString(post.author_name, "匿名树洞")
        : "匿名同学"
      : asString(post.author_name, asString(author.name, "观澜同学")),
    author_badge: asString(post.author_badge, asString(author.badge)) || undefined,
    is_anonymous: isAnonymous,
    created_at: asString(post.created_at, new Date().toISOString()),
    likes_count: asNumber(
      post.likes_count,
      asNumber(post.reaction_count, asNumber(reactionCounts.like)),
    ),
    comment_count: asNumber(post.comment_count, rawComments.length),
    comments: rawComments.map(normalizeComment),
    liked: post.liked === true || post.viewer_has_reacted === true,
    is_pinned: post.is_pinned === true,
    location: asString(post.location) || undefined,
    resolution_status:
      post.resolved === true || rawResolution === "resolved" || rawResolution === "closed"
        ? "resolved"
        : category === "lost_found"
          ? "open"
          : undefined,
    lost_found_type:
      rawLostFoundType === "found" || rawLostFoundType === "lost"
        ? rawLostFoundType
        : undefined,
  };
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Campus Wall API responded with ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function fetchPosts(signal?: AbortSignal): Promise<{
  items: WallPost[];
  next_cursor: string | null;
}> {
  const payload = asRecord(
    await requestJson("/api/v1/posts", { method: "GET", signal }),
  );
  const items = Array.isArray(payload.items) ? payload.items : [];

  return {
    items: items.map((post, index) => normalizePost(post, index)),
    next_cursor:
      typeof payload.next_cursor === "string" ? payload.next_cursor : null,
  };
}

export async function createPost(input: CreatePostInput): Promise<WallPost | null> {
  const payload = await requestJson("/api/v1/posts", {
    method: "POST",
    body: JSON.stringify({
      board: input.category,
      title: input.title,
      body: input.content,
      author_name: "观澜同学",
      anonymous: input.is_anonymous,
      tags: input.tags,
      kind: input.lost_found_type,
      location: input.location,
      resolved: input.resolution_status === "resolved",
    }),
  });

  const response = asRecord(payload);
  const post = response.item ?? payload;
  return post ? normalizePost(post, 0, input.category) : null;
}

export async function toggleLike(postId: string): Promise<{
  reaction_count: number;
  liked: boolean;
}> {
  const payload = asRecord(await requestJson(`/api/v1/posts/${encodeURIComponent(postId)}/reactions`, {
    method: "POST",
    body: JSON.stringify({ reaction_type: "like" }),
  }));

  return {
    reaction_count: asNumber(payload.reaction_count),
    liked: payload.liked === true,
  };
}

export async function createComment(
  postId: string,
  input: CreateCommentInput,
): Promise<WallComment> {
  const payload = await requestJson(`/api/v1/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body: input.content,
      author_name: "观澜同学",
      anonymous: input.is_anonymous,
    }),
  });

  const response = asRecord(payload);
  return normalizeComment(response.item ?? payload);
}

export async function updateResolution(
  postId: string,
  resolutionStatus: ResolutionStatus,
): Promise<ResolutionStatus> {
  const payload = asRecord(await requestJson(`/api/v1/posts/${encodeURIComponent(postId)}/resolution`, {
    method: "PATCH",
    body: JSON.stringify({ resolved: resolutionStatus === "resolved" }),
  }));

  return typeof payload.resolved === "boolean"
    ? payload.resolved
      ? "resolved"
      : "open"
    : resolutionStatus;
}
