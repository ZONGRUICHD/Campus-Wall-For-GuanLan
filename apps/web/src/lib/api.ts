import {
  isBoardId,
  type BoardId,
  type CreateCommentInput,
  type CreatePostInput,
  type PublicationStatus,
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

export type UserProfile = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  campus_verified: boolean;
  level: number;
  reputation: number;
  profile_visibility: "campus" | "private";
  show_activity: boolean;
  allow_direct_messages: boolean;
  follower_count: number;
  following_count: number;
  created_at: string;
};

export type DeviceSession = {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  current: boolean;
};

export type CampusVerification = {
  id: string;
  school_name: string;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportCategory =
  | "harassment"
  | "privacy"
  | "misinformation"
  | "violence"
  | "spam"
  | "illegal"
  | "other";

export type CampusReport = {
  id: string;
  reporter_user_id: string;
  target_type: "post" | "comment" | "user";
  target_id: string;
  category: ReportCategory;
  description: string;
  emergency: boolean;
  priority: number;
  status: "submitted" | "in_review" | "resolved" | "rejected";
  assigned_to_user_id: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditEntry = {
  id: number;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type UpdatePostInput = {
  title?: string | null;
  content?: string;
  tags?: string[];
  is_anonymous?: boolean;
  comments_enabled?: boolean;
  publication_status?: PublicationStatus;
  scheduled_for?: string;
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
  const rawDetail = record.detail;
  const detail = asRecord(rawDetail);
  const validationMessage = Array.isArray(rawDetail)
    ? rawDetail
        .map((item) => asString(asRecord(item).msg))
        .filter(Boolean)
        .join("；")
    : "";
  throw new ApiError(
    response.status,
    asString(detail.code, "request_failed"),
    asString(
      detail.message,
      typeof rawDetail === "string"
        ? rawDetail
        : validationMessage ||
            `Campus Wall API responded with ${response.status}`,
    ),
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
    can_edit: comment.can_edit === true,
    parent_id:
      comment.parent_id === null || comment.parent_id === undefined
        ? undefined
        : asId(comment.parent_id),
    depth: asNumber(comment.depth),
    likes_count: asNumber(comment.reaction_count),
    liked: comment.liked === true,
    edited_at: asString(comment.edited_at) || undefined,
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
    can_edit: post.can_edit === true,
    created_at: asString(post.created_at, new Date().toISOString()),
    edited_at: asString(post.edited_at) || undefined,
    likes_count: asNumber(
      post.likes_count,
      asNumber(post.reaction_count, asNumber(reactionCounts.like)),
    ),
    comment_count: asNumber(post.comment_count, rawComments.length),
    comments: rawComments.map(normalizeComment),
    liked: post.liked === true || post.viewer_has_reacted === true,
    bookmarked: post.bookmarked === true,
    comments_enabled: post.comments_enabled !== false,
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
    publication_status:
      post.publication_status === "draft" ||
      post.publication_status === "scheduled" ||
      post.publication_status === "published"
        ? post.publication_status
        : "published",
    scheduled_for: asString(post.scheduled_for) || undefined,
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

export async function fetchMyProfile(): Promise<UserProfile> {
  return (await requestJson("/api/v1/users/me/profile")) as UserProfile;
}

export async function updateMyProfile(input: {
  display_name?: string;
  bio?: string | null;
  avatar_url?: string | null;
}): Promise<UserProfile> {
  return (await requestJson("/api/v1/users/me/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  })) as UserProfile;
}

export async function updateMyPrivacy(input: {
  profile_visibility?: "campus" | "private";
  show_activity?: boolean;
  allow_direct_messages?: boolean;
}): Promise<UserProfile> {
  return (await requestJson("/api/v1/users/me/privacy", {
    method: "PATCH",
    body: JSON.stringify(input),
  })) as UserProfile;
}

export async function fetchDeviceSessions(): Promise<DeviceSession[]> {
  const payload = asRecord(await requestJson("/api/v1/users/me/sessions"));
  return Array.isArray(payload.items)
    ? (payload.items as DeviceSession[])
    : [];
}

export async function revokeDeviceSession(sessionId: string): Promise<void> {
  await requestJson(`/api/v1/users/me/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function fetchCampusVerification(): Promise<CampusVerification | null> {
  return (await requestJson(
    "/api/v1/users/me/campus-verification",
  )) as CampusVerification | null;
}

export async function submitCampusVerification(input: {
  school_name: string;
  student_identifier: string;
}): Promise<CampusVerification> {
  return (await requestJson("/api/v1/users/me/campus-verification", {
    method: "POST",
    body: JSON.stringify(input),
  })) as CampusVerification;
}

export async function submitReport(input: {
  target_type: "post" | "comment" | "user";
  target_id: string;
  category: ReportCategory;
  description: string;
  emergency: boolean;
}): Promise<CampusReport> {
  return (await requestJson("/api/v1/reports", {
    method: "POST",
    body: JSON.stringify(input),
  })) as CampusReport;
}

export async function fetchAdminReports(
  status: "submitted" | "in_review" = "submitted",
): Promise<CampusReport[]> {
  const payload = asRecord(
    await requestJson(`/api/v1/admin/reports?status=${status}`),
  );
  return Array.isArray(payload.items) ? (payload.items as CampusReport[]) : [];
}

export async function reviewAdminReport(
  reportId: string,
  input: {
    status: "in_review" | "resolved" | "rejected";
    resolution?: string;
    hide_target?: boolean;
  },
): Promise<CampusReport> {
  return (await requestJson(`/api/v1/admin/reports/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })) as CampusReport;
}

export async function fetchAuditEntries(): Promise<AuditEntry[]> {
  const payload = asRecord(
    await requestJson("/api/v1/admin/audit-logs?limit=100"),
  );
  return Array.isArray(payload.items) ? (payload.items as AuditEntry[]) : [];
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

export async function fetchMyPosts(): Promise<WallPost[]> {
  const payload = asRecord(await requestJson("/api/v1/posts/me"));
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.map((post, index) => normalizePost(post, index));
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
      publication_status: input.publication_status ?? "published",
      scheduled_for: input.scheduled_for,
      comments_enabled: input.comments_enabled ?? true,
    }),
  });

  const response = asRecord(payload);
  const post = response.item ?? payload;
  return post ? normalizePost(post, 0, input.category) : null;
}

export async function updatePost(
  postId: string,
  input: UpdatePostInput,
): Promise<WallPost> {
  const payload = await requestJson(
    `/api/v1/posts/${encodeURIComponent(postId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        title: input.title,
        body: input.content,
        tags: input.tags,
        anonymous: input.is_anonymous,
        comments_enabled: input.comments_enabled,
        publication_status: input.publication_status,
        scheduled_for: input.scheduled_for,
      }),
    },
  );
  return normalizePost(payload);
}

export async function deletePost(postId: string): Promise<void> {
  await requestJson(`/api/v1/posts/${encodeURIComponent(postId)}`, {
    method: "DELETE",
  });
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
      parent_id: input.parent_id ? Number(input.parent_id) : undefined,
    }),
  });

  const response = asRecord(payload);
  return normalizeComment(response.item ?? payload);
}

export async function updateComment(
  commentId: string,
  content: string,
): Promise<WallComment> {
  const payload = await requestJson(
    `/api/v1/comments/${encodeURIComponent(commentId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ body: content }),
    },
  );
  return normalizeComment(payload);
}

export async function deleteComment(commentId: string): Promise<void> {
  await requestJson(`/api/v1/comments/${encodeURIComponent(commentId)}`, {
    method: "DELETE",
  });
}

export async function toggleBookmark(postId: string): Promise<boolean> {
  const payload = asRecord(
    await requestJson(`/api/v1/posts/${encodeURIComponent(postId)}/bookmark`, {
      method: "POST",
    }),
  );
  return payload.bookmarked === true;
}

export async function toggleCommentLike(commentId: string): Promise<{
  reaction_count: number;
  liked: boolean;
}> {
  const payload = asRecord(
    await requestJson(
      `/api/v1/comments/${encodeURIComponent(commentId)}/reactions`,
      { method: "POST" },
    ),
  );
  return {
    reaction_count: asNumber(payload.reaction_count),
    liked: payload.liked === true,
  };
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
