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
const REFRESH_TOKEN_KEY = "guanlan-campus-wall.refresh-token";

let accessToken: string | null = null;
let refreshPromise: Promise<AuthSession | null> | null = null;

type JsonRecord = Record<string, unknown>;

export type AuthUser = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  status: string;
  campus_verified: boolean;
  must_change_password: boolean;
  roles: string[];
  permissions: string[];
};

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: AuthUser;
};

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeAuthUser(value: unknown): AuthUser {
  const user = asRecord(value);
  return {
    id: asString(user.id),
    username: asString(user.username),
    display_name: asString(user.display_name, "观澜同学"),
    email: typeof user.email === "string" ? user.email : null,
    status: asString(user.status, "active"),
    campus_verified: user.campus_verified === true,
    must_change_password: user.must_change_password === true,
    roles: asStringArray(user.roles),
    permissions: asStringArray(user.permissions),
  };
}

function normalizeAuthSession(value: unknown): AuthSession {
  const session = asRecord(value);
  return {
    access_token: asString(session.access_token),
    refresh_token: asString(session.refresh_token),
    expires_in: asNumber(session.expires_in),
    user: normalizeAuthUser(session.user),
  };
}

function storedRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

function rememberSession(session: AuthSession): AuthSession {
  accessToken = session.access_token;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
  }
  return session;
}

export function clearSession(): void {
  accessToken = null;
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

async function responseJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload;

  const record = asRecord(payload);
  const detail = asRecord(record.detail);
  throw new ApiError(
    response.status,
    asString(detail.code, "request_failed"),
    asString(detail.message, `Campus Wall API responded with ${response.status}`),
  );
}

async function refreshStoredSession(): Promise<AuthSession | null> {
  const refreshToken = storedRefreshToken();
  if (!refreshToken) {
    clearSession();
    return null;
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    clearSession();
    return null;
  }
  return rememberSession(normalizeAuthSession(await response.json()));
}

export async function restoreSession(): Promise<AuthSession | null> {
  if (!refreshPromise) {
    refreshPromise = refreshStoredSession().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
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

async function requestJson(
  path: string,
  init?: RequestInit,
  retryAfterRefresh = true,
): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401 && retryAfterRefresh && storedRefreshToken()) {
    const restored = await restoreSession();
    if (restored) return requestJson(path, init, false);
  }
  return responseJson(response);
}

export async function login(
  username: string,
  password: string,
): Promise<AuthSession> {
  const payload = await requestJson(
    "/api/v1/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password }),
    },
    false,
  );
  return rememberSession(normalizeAuthSession(payload));
}

export async function register(input: {
  username: string;
  password: string;
  display_name: string;
  email?: string;
}): Promise<AuthSession> {
  await requestJson(
    "/api/v1/auth/register",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    false,
  );
  return login(input.username, input.password);
}

export async function logout(): Promise<void> {
  try {
    if (accessToken) {
      await requestJson("/api/v1/auth/logout", { method: "POST" }, false);
    }
  } finally {
    clearSession();
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await requestJson(
    "/api/v1/auth/change-password",
    {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    },
    false,
  );
  clearSession();
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
