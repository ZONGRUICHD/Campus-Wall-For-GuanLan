"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AccountDialog } from "@/components/account-dialog";
import { AdminDialog } from "@/components/admin-dialog";
import { AuthGate, PasswordChangeGate } from "@/components/auth-gate";
import { ComposerDialog } from "@/components/composer-dialog";
import {
  BellIcon,
  BoardIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  WallLogoIcon,
} from "@/components/icons";
import { PostCard } from "@/components/post-card";
import { ReportDialog } from "@/components/report-dialog";
import {
  ApiError,
  type AuthSession,
  type UserProfile,
  createComment as postComment,
  createPost as postToApi,
  deleteComment as deleteApiComment,
  fetchPosts,
  logout as logoutSession,
  restoreSession,
  toggleBookmark as toggleApiBookmark,
  toggleCommentLike as toggleApiCommentLike,
  toggleLike as toggleApiLike,
  updateComment as updateApiComment,
  updateMarketplaceListingStatus as updateApiMarketplaceStatus,
  updateResolution as updateApiResolution,
} from "@/lib/api";
import {
  BOARDS,
  getBoard,
  LOST_FOUND_CATEGORIES,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_STATUSES,
  yuanToCents,
  type BoardId,
  type CreatePostInput,
  type DataMode,
  type LostFoundCategory,
  type MarketplaceCategory,
  type MarketplaceStatus,
  type ResolutionFilter,
  type ResolutionStatus,
  type SortMode,
  type WallPost,
} from "@/lib/campus-wall";
import { DEMO_POSTS } from "@/lib/demo-data";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "latest", label: "最新发布" },
  { value: "popular", label: "最多点赞" },
  { value: "discussed", label: "讨论最多" },
];

type LostFoundCategoryFilter = "all" | LostFoundCategory;
type LostFoundTimeFilter = "all" | "7_days" | "30_days";
type MarketplaceCategoryFilter = "all" | MarketplaceCategory;
type MarketplaceStatusFilter = "all" | MarketplaceStatus;

const CALENDAR_ITEMS = [
  { date: "08.24", title: "新生志愿者集合", detail: "17:30 · 大礼堂前" },
  { date: "08.27", title: "秋季社团招新市集", detail: "15:00 · 风雨长廊" },
  { date: "08.30", title: "图书馆闭馆盘点", detail: "18:00 后闭馆" },
];

function SkeletonFeed() {
  return (
    <div aria-label="正在加载校园墙" className="skeleton-feed" role="status">
      {[0, 1, 2].map((item) => (
        <div className="post-card skeleton-card" key={item}>
          <div className="skeleton-row">
            <span className="skeleton-avatar" />
            <span className="skeleton-line skeleton-line-short" />
          </div>
          <span className="skeleton-line skeleton-line-title" />
          <span className="skeleton-line" />
          <span className="skeleton-line skeleton-line-medium" />
        </div>
      ))}
    </div>
  );
}

function EmptyFeed({
  hasSearch,
  boardName,
}: {
  hasSearch: boolean;
  boardName: string;
}) {
  return (
    <div className="empty-feed">
      <span className="empty-note-pin" />
      <BoardIcon board="daily" size={30} />
      <h2>{hasSearch ? "没有找到相符的便笺" : `${boardName}还没有内容`}</h2>
      <p>
        {hasSearch
          ? "换个关键词，或清空筛选再看看。"
          : "来贴上第一张便笺，让这里热闹起来吧。"}
      </p>
    </div>
  );
}

export function CampusWall() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [dataMode, setDataMode] = useState<DataMode>("loading");
  const [isSyncing, setIsSyncing] = useState(true);
  const [activeBoard, setActiveBoard] = useState<BoardId>("news");
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [resolutionFilter, setResolutionFilter] =
    useState<ResolutionFilter>("all");
  const [lostFoundCategoryFilter, setLostFoundCategoryFilter] =
    useState<LostFoundCategoryFilter>("all");
  const [lostFoundTimeFilter, setLostFoundTimeFilter] =
    useState<LostFoundTimeFilter>("all");
  const [lostFoundTimeCutoff, setLostFoundTimeCutoff] = useState<number | null>(
    null,
  );
  const [marketplaceCategoryFilter, setMarketplaceCategoryFilter] =
    useState<MarketplaceCategoryFilter>("all");
  const [marketplaceStatusFilter, setMarketplaceStatusFilter] =
    useState<MarketplaceStatusFilter>("all");
  const [marketplaceMinPrice, setMarketplaceMinPrice] = useState("");
  const [marketplaceMaxPrice, setMarketplaceMaxPrice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const requestControllerRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void restoreSession()
      .then((session) => {
        if (active) setAuthSession(session);
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const announce = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToastMessage(""), 3200);
  }, []);

  const syncPosts = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setIsSyncing(true);
    const timeoutId = window.setTimeout(() => controller.abort(), 3500);

    try {
      const response = await fetchPosts(controller.signal);
      if (controller.signal.aborted) return;

      setPosts(response.items);
      setDataMode("live");
    } catch (error) {
      if (
        controller.signal.aborted &&
        requestControllerRef.current !== controller
      ) {
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        setAuthSession(null);
        setAuthNotice("登录状态已过期，请重新登录。");
        return;
      }
      setPosts((current) => (current.length > 0 ? current : [...DEMO_POSTS]));
      setDataMode("demo");
      announce("校园服务暂时没连上，已自动切换到演示数据");
    } finally {
      window.clearTimeout(timeoutId);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setIsSyncing(false);
      }
    }
  }, [announce]);

  useEffect(() => {
    if (!authSession || authSession.user.must_change_password) return;
    const startTimer = window.setTimeout(() => void syncPosts(), 0);

    return () => {
      window.clearTimeout(startTimer);
      const activeRequest = requestControllerRef.current;
      requestControllerRef.current = null;
      activeRequest?.abort();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [authSession, syncPosts]);

  const switchToSessionMode = useCallback(() => {
    setDataMode("demo");
    announce("刚才的操作已保留，本次会话可以继续使用");
  }, [announce]);

  const handleApiFailure = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        setAuthSession(null);
        setAuthNotice("登录状态已过期，请重新登录。");
        return;
      }
      if (error instanceof ApiError) {
        announce(error.message);
        return;
      }
      switchToSessionMode();
    },
    [announce, switchToSessionMode],
  );

  function handleAuthenticated(session: AuthSession) {
    setAuthSession(session);
    setAuthNotice("");
    setPosts([]);
    setDataMode("loading");
  }

  async function handleLogout() {
    await logoutSession();
    setAuthSession(null);
    setAuthNotice("你已安全退出校园墙。");
    setPosts([]);
    setDataMode("loading");
  }

  function handleProfileUpdated(profile: UserProfile) {
    setAuthSession((current) =>
      current
        ? {
            ...current,
            user: {
              ...current.user,
              display_name: profile.display_name,
              campus_verified: profile.campus_verified,
            },
          }
        : current,
    );
  }

  const boardCounts = useMemo(() => {
    return BOARDS.reduce<Record<BoardId, number>>(
      (counts, board) => {
        counts[board.id] = posts.filter(
          (post) => post.category === board.id,
        ).length;
        return counts;
      },
      {
        news: 0,
        daily: 0,
        lost_found: 0,
        marketplace: 0,
        confession: 0,
        tree_hole: 0,
      },
    );
  }, [posts]);

  const hotTags = useMemo(() => {
    const counts = new Map<string, number>();
    posts.forEach((post) => {
      post.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    });

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 5);
  }, [posts]);

  const filteredPosts = useMemo(() => {
    const normalizedQuery = deferredSearch.trim().toLocaleLowerCase("zh-CN");
    const minimumPrice = marketplaceMinPrice.trim()
      ? yuanToCents(marketplaceMinPrice)
      : null;
    const maximumPrice = marketplaceMaxPrice.trim()
      ? yuanToCents(marketplaceMaxPrice)
      : null;
    const result = posts.filter((post) => {
      if (post.category !== activeBoard) return false;
      if (
        activeBoard === "lost_found" &&
        resolutionFilter !== "all" &&
        (post.resolution_status ?? "open") !== resolutionFilter
      ) {
        return false;
      }
      if (
        activeBoard === "lost_found" &&
        lostFoundCategoryFilter !== "all" &&
        post.item_category !== lostFoundCategoryFilter
      ) {
        return false;
      }
      if (activeBoard === "lost_found" && lostFoundTimeFilter !== "all") {
        const occurredAt = post.occurred_at
          ? new Date(post.occurred_at).getTime()
          : Number.NaN;
        if (
          Number.isNaN(occurredAt) ||
          (lostFoundTimeCutoff !== null && occurredAt < lostFoundTimeCutoff)
        ) {
          return false;
        }
      }
      if (
        activeBoard === "marketplace" &&
        marketplaceCategoryFilter !== "all" &&
        post.marketplace?.category !== marketplaceCategoryFilter
      ) {
        return false;
      }
      if (
        activeBoard === "marketplace" &&
        marketplaceStatusFilter !== "all" &&
        post.marketplace?.status !== marketplaceStatusFilter
      ) {
        return false;
      }
      if (
        activeBoard === "marketplace" &&
        minimumPrice !== null &&
        (post.marketplace?.price_cents ?? -1) < minimumPrice
      ) {
        return false;
      }
      if (
        activeBoard === "marketplace" &&
        maximumPrice !== null &&
        (post.marketplace?.price_cents ?? Number.POSITIVE_INFINITY) >
          maximumPrice
      ) {
        return false;
      }
      if (!normalizedQuery) return true;

      const searchableText = [
        post.title,
        post.content,
        post.author_name,
        post.location,
        post.marketplace?.meetup_location,
        ...post.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      return searchableText.includes(normalizedQuery);
    });

    return result.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      if (sortMode === "popular") return b.likes_count - a.likes_count;
      if (sortMode === "discussed") return b.comment_count - a.comment_count;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [
    activeBoard,
    deferredSearch,
    lostFoundCategoryFilter,
    lostFoundTimeCutoff,
    lostFoundTimeFilter,
    marketplaceCategoryFilter,
    marketplaceMaxPrice,
    marketplaceMinPrice,
    marketplaceStatusFilter,
    posts,
    resolutionFilter,
    sortMode,
  ]);

  async function handleCreatePost(input: CreatePostInput) {
    const now = new Date();
    const localId = `local-post-${now.getTime()}`;
    const publicationStatus = input.publication_status ?? "published";
    const showInFeed = publicationStatus === "published";
    const localPost: WallPost = {
      id: localId,
      category: input.category,
      title: input.title,
      content: input.content,
      tags: input.tags,
      author_name: input.is_anonymous
        ? input.category === "tree_hole"
          ? "树洞新叶"
          : "匿名同学"
        : (authSession?.user.display_name ?? "我"),
      is_anonymous: input.is_anonymous,
      can_edit: true,
      created_at: now.toISOString(),
      time_label: "刚刚",
      likes_count: 0,
      comment_count: 0,
      comments: [],
      liked: false,
      location: input.location,
      lost_found_type: input.lost_found_type,
      item_category: input.item_category,
      occurred_at: input.occurred_at,
      resolution_status: input.resolution_status,
      publication_status: publicationStatus,
      scheduled_for: input.scheduled_for,
      comments_enabled: input.comments_enabled ?? true,
      media: [],
      marketplace: input.marketplace
        ? {
            ...input.marketplace,
            original_price_cents:
              input.marketplace.original_price_cents ?? null,
            status: "available",
            seller_user_id: authSession?.user.id ?? null,
          }
        : undefined,
    };

    if (dataMode === "loading") {
      const activeRequest = requestControllerRef.current;
      requestControllerRef.current = null;
      activeRequest?.abort();
      setDataMode("demo");
    }

    if (showInFeed) {
      setPosts((current) => [
        localPost,
        ...(current.length > 0 ? current : DEMO_POSTS),
      ]);
      setActiveBoard(input.category);
      setResolutionFilter("all");
      setLostFoundCategoryFilter("all");
      setLostFoundTimeFilter("all");
      setLostFoundTimeCutoff(null);
      setMarketplaceCategoryFilter("all");
      setMarketplaceStatusFilter("all");
      setMarketplaceMinPrice("");
      setMarketplaceMaxPrice("");
    }

    if (dataMode !== "live") {
      if (!showInFeed) {
        const error = new ApiError(
          503,
          "offline_draft_unavailable",
          "演示模式不能可靠保存草稿或定时内容，请重新连接后再试。",
        );
        announce(error.message);
        throw error;
      }
      announce(`已发布到${getBoard(input.category).name}（仅保留在本次会话）`);
      return;
    }

    try {
      const savedPost = await postToApi(input);
      if (savedPost && showInFeed) {
        setPosts((current) =>
          current.map((post) =>
            post.id === localId
              ? {
                  ...localPost,
                  ...savedPost,
                  time_label: savedPost.time_label ?? "刚刚",
                }
              : post,
          ),
        );
      }
      announce(
        publicationStatus === "draft"
          ? "草稿已保存，可在“头像 → 我的内容”中继续编辑"
          : publicationStatus === "scheduled"
            ? "定时发布已安排，可在“头像 → 我的内容”中调整"
            : `已发布到${getBoard(input.category).name}`,
      );
    } catch (error) {
      if (showInFeed) {
        setPosts((current) => current.filter((post) => post.id !== localId));
      }
      handleApiFailure(error);
      throw error;
    }
  }

  async function handleLike(postId: string) {
    const target = posts.find((post) => post.id === postId);
    if (!target) return;

    setPosts((current) =>
      current.map((post) =>
        post.id === postId
          ? {
              ...post,
              liked: !post.liked,
              likes_count: Math.max(
                0,
                post.likes_count + (post.liked ? -1 : 1),
              ),
            }
          : post,
      ),
    );

    if (dataMode !== "live") return;
    try {
      const reaction = await toggleApiLike(postId);
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? {
                ...post,
                likes_count: reaction.reaction_count,
                liked: reaction.liked,
              }
            : post,
        ),
      );
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function handleBookmark(postId: string) {
    setPosts((current) =>
      current.map((post) =>
        post.id === postId ? { ...post, bookmarked: !post.bookmarked } : post,
      ),
    );
    if (dataMode !== "live") return;
    try {
      const bookmarked = await toggleApiBookmark(postId);
      setPosts((current) =>
        current.map((post) =>
          post.id === postId ? { ...post, bookmarked } : post,
        ),
      );
      announce(bookmarked ? "已收藏到个人列表" : "已取消收藏");
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function handleCommentLike(postId: string, commentId: string) {
    setPosts((current) =>
      current.map((post) =>
        post.id === postId
          ? {
              ...post,
              comments: post.comments.map((comment) =>
                comment.id === commentId
                  ? {
                      ...comment,
                      liked: !comment.liked,
                      likes_count: Math.max(
                        0,
                        (comment.likes_count ?? 0) + (comment.liked ? -1 : 1),
                      ),
                    }
                  : comment,
              ),
            }
          : post,
      ),
    );
    if (dataMode !== "live") return;
    try {
      const reaction = await toggleApiCommentLike(commentId);
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? {
                ...post,
                comments: post.comments.map((comment) =>
                  comment.id === commentId
                    ? {
                        ...comment,
                        liked: reaction.liked,
                        likes_count: reaction.reaction_count,
                      }
                    : comment,
                ),
              }
            : post,
        ),
      );
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function handleCommentEdit(
    postId: string,
    commentId: string,
    content: string,
  ) {
    if (dataMode !== "live") {
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? {
                ...post,
                comments: post.comments.map((comment) =>
                  comment.id === commentId
                    ? {
                        ...comment,
                        content,
                        edited_at: new Date().toISOString(),
                      }
                    : comment,
                ),
              }
            : post,
        ),
      );
      announce("评论已更新（仅保留在本次会话）");
      return;
    }
    try {
      const savedComment = await updateApiComment(commentId, content);
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? {
                ...post,
                comments: post.comments.map((comment) =>
                  comment.id === commentId
                    ? { ...comment, ...savedComment }
                    : comment,
                ),
              }
            : post,
        ),
      );
      announce("评论已更新");
    } catch (error) {
      handleApiFailure(error);
      throw error;
    }
  }

  async function handleCommentDelete(postId: string, commentId: string) {
    if (dataMode === "live") {
      try {
        await deleteApiComment(commentId);
      } catch (error) {
        handleApiFailure(error);
        throw error;
      }
    }
    setPosts((current) =>
      current.map((post) =>
        post.id === postId
          ? {
              ...post,
              comment_count: Math.max(0, post.comment_count - 1),
              comments: post.comments.filter(
                (comment) => comment.id !== commentId,
              ),
            }
          : post,
      ),
    );
    announce(
      dataMode === "live" ? "评论已删除" : "评论已删除（仅影响本次会话）",
    );
  }

  async function handleComment(
    postId: string,
    content: string,
    isAnonymous: boolean,
    parentId?: string,
  ) {
    const now = new Date();
    const localCommentId = `local-comment-${now.getTime()}`;
    const targetPost = posts.find((post) => post.id === postId);
    const parent = targetPost?.comments.find(
      (comment) => comment.id === parentId,
    );
    setPosts((current) =>
      current.map((post) =>
        post.id === postId
          ? {
              ...post,
              comment_count: post.comment_count + 1,
              comments: [
                ...post.comments,
                {
                  id: localCommentId,
                  content,
                  author_name: isAnonymous
                    ? post.category === "tree_hole"
                      ? "树洞新叶"
                      : "匿名同学"
                    : "我",
                  is_anonymous: isAnonymous,
                  can_edit: true,
                  parent_id: parentId,
                  depth: parent ? (parent.depth ?? 0) + 1 : 0,
                  likes_count: 0,
                  liked: false,
                  created_at: now.toISOString(),
                  time_label: "刚刚",
                },
              ],
            }
          : post,
      ),
    );
    announce("评论已经贴上去了");

    if (dataMode !== "live") return;
    try {
      const savedComment = await postComment(postId, {
        content,
        is_anonymous: isAnonymous,
        parent_id: parentId,
      });
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? {
                ...post,
                comments: post.comments.map((comment) =>
                  comment.id === localCommentId ? savedComment : comment,
                ),
              }
            : post,
        ),
      );
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function handleResolutionChange(
    postId: string,
    resolutionStatus: ResolutionStatus,
  ) {
    setPosts((current) =>
      current.map((post) =>
        post.id === postId
          ? { ...post, resolution_status: resolutionStatus }
          : post,
      ),
    );
    announce(
      resolutionStatus === "resolved"
        ? "已标记为解决"
        : "这条失物信息已重新开启",
    );

    if (dataMode !== "live") return;
    try {
      const savedStatus = await updateApiResolution(postId, resolutionStatus);
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? { ...post, resolution_status: savedStatus }
            : post,
        ),
      );
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function handleMarketplaceStatusChange(
    postId: string,
    status: MarketplaceStatus,
  ) {
    const target = posts.find((post) => post.id === postId);
    if (!target?.marketplace) return;
    const previousListing = target.marketplace;
    const statusLabel =
      MARKETPLACE_STATUSES.find((item) => item.id === status)?.label ?? status;

    setPosts((current) =>
      current.map((post) =>
        post.id === postId && post.marketplace
          ? {
              ...post,
              marketplace: { ...post.marketplace, status },
            }
          : post,
      ),
    );

    if (dataMode !== "live") {
      if (status === "withdrawn") {
        setPosts((current) => current.filter((post) => post.id !== postId));
      }
      announce(`商品状态已更新为“${statusLabel}”（仅保留在本次会话）`);
      return;
    }

    try {
      const savedListing = await updateApiMarketplaceStatus(postId, status);
      setPosts((current) =>
        status === "withdrawn"
          ? current.filter((post) => post.id !== postId)
          : current.map((post) =>
              post.id === postId
                ? { ...post, marketplace: savedListing }
                : post,
            ),
      );
      announce(
        status === "withdrawn"
          ? "商品已下架，可在“头像 → 我的内容”中重新编辑"
          : `商品状态已更新为“${statusLabel}”`,
      );
    } catch (error) {
      setPosts((current) =>
        current.map((post) =>
          post.id === postId ? { ...post, marketplace: previousListing } : post,
        ),
      );
      handleApiFailure(error);
    }
  }

  function handleClaimAccepted(postId: string) {
    setPosts((current) =>
      current.map((post) =>
        post.id === postId ? { ...post, resolution_status: "resolved" } : post,
      ),
    );
    announce("认领线索已确认，失物信息已自动标记为解决");
  }

  function chooseBoard(boardId: BoardId) {
    setActiveBoard(boardId);
    setResolutionFilter("all");
    setLostFoundCategoryFilter("all");
    setLostFoundTimeFilter("all");
    setLostFoundTimeCutoff(null);
    setMarketplaceCategoryFilter("all");
    setMarketplaceStatusFilter("all");
    setMarketplaceMinPrice("");
    setMarketplaceMaxPrice("");
  }

  function chooseLostFoundTimeFilter(filter: LostFoundTimeFilter) {
    setLostFoundTimeFilter(filter);
    if (filter === "all") {
      setLostFoundTimeCutoff(null);
      return;
    }
    const days = filter === "7_days" ? 7 : 30;
    setLostFoundTimeCutoff(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  if (!authReady) {
    return (
      <main className="auth-loading" aria-live="polite">
        <span className="brand-mark">
          <WallLogoIcon size={28} />
        </span>
        <strong>正在安全连接校园墙…</strong>
      </main>
    );
  }

  if (!authSession) {
    return (
      <AuthGate notice={authNotice} onAuthenticated={handleAuthenticated} />
    );
  }

  if (authSession.user.must_change_password) {
    return (
      <PasswordChangeGate
        onComplete={() => {
          setAuthSession(null);
          setAuthNotice("密码已更新，请使用新密码重新登录。");
        }}
        onSignOut={() => {
          setAuthSession(null);
          setAuthNotice("你已安全退出校园墙。");
        }}
        username={authSession.user.username}
      />
    );
  }

  const activeBoardMeta = getBoard(activeBoard);
  const modeLabel = isSyncing
    ? "正在同步"
    : dataMode === "live"
      ? "校园服务在线"
      : dataMode === "demo"
        ? "演示数据"
        : "正在连接";

  return (
    <div className="campus-wall" data-active-board={activeBoard}>
      <a className="skip-link" href="#main-feed">
        跳到帖子列表
      </a>

      <header className="site-header">
        <div className="site-header-inner">
          <a aria-label="观澜校园墙首页" className="brand" href="#main-feed">
            <span className="brand-mark">
              <WallLogoIcon size={25} />
            </span>
            <span className="brand-copy">
              <strong>观澜校园墙</strong>
              <small>GUANLAN CAMPUS WALL</small>
            </span>
          </a>

          <nav aria-label="页面导航" className="top-nav">
            <a aria-current="page" href="#main-feed">
              广场
            </a>
            <a href="#campus-calendar">校历</a>
            <a href="#wall-guide">墙贴公约</a>
          </nav>

          <div className="header-actions">
            <span className="data-status" data-mode={dataMode}>
              <i aria-hidden="true" />
              {modeLabel}
            </span>
            <button
              aria-label="查看通知"
              className="icon-button header-bell"
              onClick={() => announce("今天没有未读通知，去校园墙逛逛吧")}
              type="button"
            >
              <BellIcon size={20} />
            </button>
            <button
              className="primary-button header-publish"
              onClick={() => setComposerOpen(true)}
              type="button"
            >
              <PlusIcon size={18} />
              <span>发布便笺</span>
            </button>
            {authSession.user.permissions.includes("reports:manage") ? (
              <button
                className="admin-console-button"
                onClick={() => setAdminOpen(true)}
                type="button"
              >
                治理台
              </button>
            ) : null}
            <div className="user-account">
              <button
                aria-label={`当前用户：${authSession.user.display_name}`}
                className="user-avatar"
                onClick={() => setAccountOpen(true)}
                title={authSession.user.display_name}
                type="button"
              >
                {authSession.user.display_name.slice(0, 1)}
              </button>
              <button
                className="logout-button"
                onClick={() => void handleLogout()}
                type="button"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="page-frame">
        {dataMode === "demo" ? (
          <section aria-label="演示数据状态" className="demo-notice">
            <div className="demo-notice-icon">
              <WallLogoIcon size={20} />
            </div>
            <div>
              <strong>当前展示演示数据</strong>
              <p>
                校园服务暂时不可用，发布、点赞和评论仍可使用，并保留到本次页面会话结束。
              </p>
            </div>
            <button
              disabled={isSyncing}
              onClick={() => void syncPosts()}
              type="button"
            >
              <RefreshIcon size={16} />
              {isSyncing ? "正在重连" : "重新连接"}
            </button>
          </section>
        ) : null}

        <div className="workspace-grid">
          <aside aria-label="校园墙板块" className="board-sidebar">
            <div className="sidebar-sticky">
              <section className="paper-panel board-panel">
                <div className="panel-heading">
                  <span className="eyebrow">THE BULLETIN</span>
                  <h2>校园布告栏</h2>
                </div>
                <nav className="board-nav">
                  {BOARDS.map((board) => (
                    <button
                      aria-current={
                        activeBoard === board.id ? "page" : undefined
                      }
                      className="board-nav-item"
                      data-active={activeBoard === board.id}
                      data-board={board.id}
                      key={board.id}
                      onClick={() => chooseBoard(board.id)}
                      type="button"
                    >
                      <span className="board-nav-icon">
                        <BoardIcon board={board.id} size={19} />
                      </span>
                      <span className="board-nav-copy">
                        <strong>{board.name}</strong>
                        <small>{board.eyebrow}</small>
                      </span>
                      <span className="board-count">
                        {boardCounts[board.id]}
                      </span>
                    </button>
                  ))}
                </nav>
              </section>

              <section className="sidebar-note">
                <span className="paper-tape" />
                <p>“愿每一句真诚的话，都能在校园里找到回声。”</p>
                <small>— 今日墙边小语</small>
              </section>
            </div>
          </aside>

          <main className="feed-column" id="main-feed">
            <section className="feed-hero" data-board={activeBoard}>
              <div className="feed-hero-icon">
                <BoardIcon board={activeBoard} size={26} />
              </div>
              <div>
                <span className="eyebrow">{activeBoardMeta.eyebrow}</span>
                <h1>{activeBoardMeta.name}</h1>
                <p>{activeBoardMeta.description}</p>
              </div>
              <span className="hero-post-count">
                {boardCounts[activeBoard]} 张便笺
              </span>
            </section>

            <section aria-label="搜索与排序" className="feed-toolbar">
              <label className="search-field">
                <span className="sr-only">搜索当前板块</span>
                <SearchIcon size={19} />
                <input
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={`搜索${activeBoardMeta.name}…`}
                  type="search"
                  value={searchQuery}
                />
                {searchQuery ? (
                  <button
                    aria-label="清空搜索"
                    onClick={() => setSearchQuery("")}
                    type="button"
                  >
                    清空
                  </button>
                ) : null}
              </label>
              <label className="sort-field">
                <span className="sr-only">帖子排序方式</span>
                <select
                  onChange={(event) =>
                    setSortMode(event.target.value as SortMode)
                  }
                  value={sortMode}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {activeBoard === "lost_found" ? (
              <div
                aria-label="失物招领筛选"
                className="lost-found-filter-panel"
              >
                <div aria-label="失物状态筛选" className="resolution-filter">
                  {(
                    [
                      ["all", "全部"],
                      ["open", "进行中"],
                      ["resolved", "已解决"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      aria-pressed={resolutionFilter === value}
                      key={value}
                      onClick={() => setResolutionFilter(value)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="lost-found-filter-select">
                  <span>物品分类</span>
                  <select
                    onChange={(event) =>
                      setLostFoundCategoryFilter(
                        event.target.value as LostFoundCategoryFilter,
                      )
                    }
                    value={lostFoundCategoryFilter}
                  >
                    <option value="all">全部分类</option>
                    {LOST_FOUND_CATEGORIES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lost-found-filter-select">
                  <span>发生时间</span>
                  <select
                    onChange={(event) =>
                      chooseLostFoundTimeFilter(
                        event.target.value as LostFoundTimeFilter,
                      )
                    }
                    value={lostFoundTimeFilter}
                  >
                    <option value="all">不限时间</option>
                    <option value="7_days">最近 7 天</option>
                    <option value="30_days">最近 30 天</option>
                  </select>
                </label>
              </div>
            ) : null}

            {activeBoard === "marketplace" ? (
              <div
                aria-label="二手商品筛选"
                className="marketplace-filter-panel"
              >
                <label className="lost-found-filter-select">
                  <span>商品分类</span>
                  <select
                    onChange={(event) =>
                      setMarketplaceCategoryFilter(
                        event.target.value as MarketplaceCategoryFilter,
                      )
                    }
                    value={marketplaceCategoryFilter}
                  >
                    <option value="all">全部分类</option>
                    {MARKETPLACE_CATEGORIES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lost-found-filter-select">
                  <span>交易状态</span>
                  <select
                    onChange={(event) =>
                      setMarketplaceStatusFilter(
                        event.target.value as MarketplaceStatusFilter,
                      )
                    }
                    value={marketplaceStatusFilter}
                  >
                    <option value="all">全部状态</option>
                    {MARKETPLACE_STATUSES.filter(
                      (item) => item.id !== "withdrawn",
                    ).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="marketplace-price-filter">
                  <span>价格区间（元）</span>
                  <div>
                    <input
                      aria-label="最低价格"
                      inputMode="decimal"
                      max="100000"
                      min="0"
                      onChange={(event) =>
                        setMarketplaceMinPrice(event.target.value)
                      }
                      placeholder="最低"
                      step="0.01"
                      type="number"
                      value={marketplaceMinPrice}
                    />
                    <span aria-hidden="true">—</span>
                    <input
                      aria-label="最高价格"
                      inputMode="decimal"
                      max="100000"
                      min="0"
                      onChange={(event) =>
                        setMarketplaceMaxPrice(event.target.value)
                      }
                      placeholder="最高"
                      step="0.01"
                      type="number"
                      value={marketplaceMaxPrice}
                    />
                  </div>
                </div>
                {marketplaceMinPrice &&
                marketplaceMaxPrice &&
                yuanToCents(marketplaceMinPrice) !== null &&
                yuanToCents(marketplaceMaxPrice) !== null &&
                (yuanToCents(marketplaceMinPrice) ?? 0) >
                  (yuanToCents(marketplaceMaxPrice) ?? 0) ? (
                  <p className="marketplace-filter-error" role="alert">
                    最低价格不能高于最高价格
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="feed-result-line">
              <span>
                {dataMode === "loading"
                  ? "正在整理墙上的便笺…"
                  : `找到 ${filteredPosts.length} 张便笺`}
              </span>
              {deferredSearch ? <small>关键词：{deferredSearch}</small> : null}
            </div>

            {dataMode === "loading" ? (
              <SkeletonFeed />
            ) : filteredPosts.length > 0 ? (
              <div className="post-list">
                {filteredPosts.map((post) => (
                  <PostCard
                    claimsAvailable={dataMode === "live"}
                    currentUserId={authSession.user.id}
                    key={post.id}
                    onBookmark={handleBookmark}
                    onComment={handleComment}
                    onCommentDelete={handleCommentDelete}
                    onCommentEdit={handleCommentEdit}
                    onCommentLike={handleCommentLike}
                    onClaimAccepted={handleClaimAccepted}
                    onLike={handleLike}
                    onMarketplaceStatusChange={handleMarketplaceStatusChange}
                    onReport={(postId, title) =>
                      setReportTarget({ id: postId, title })
                    }
                    onResolutionChange={handleResolutionChange}
                    post={post}
                  />
                ))}
              </div>
            ) : (
              <EmptyFeed
                boardName={activeBoardMeta.name}
                hasSearch={Boolean(
                  deferredSearch ||
                  resolutionFilter !== "all" ||
                  lostFoundCategoryFilter !== "all" ||
                  lostFoundTimeFilter !== "all" ||
                  marketplaceCategoryFilter !== "all" ||
                  marketplaceStatusFilter !== "all" ||
                  marketplaceMinPrice ||
                  marketplaceMaxPrice,
                )}
              />
            )}
          </main>

          <aside aria-label="校园信息" className="right-rail">
            <section className="paper-panel date-card" id="campus-calendar">
              <div className="date-card-top">
                <div className="date-block">
                  <strong>24</strong>
                  <span>AUG · MON</span>
                </div>
                <div>
                  <span className="eyebrow">CAMPUS TODAY</span>
                  <h2>今日校园</h2>
                  <p>新学期 · 第 1 周</p>
                </div>
              </div>
              <ul className="calendar-list">
                {CALENDAR_ITEMS.map((item) => (
                  <li key={item.date + item.title}>
                    <time>{item.date}</time>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="paper-panel hot-card">
              <div className="rail-heading">
                <div>
                  <span className="eyebrow">TRENDING NOW</span>
                  <h2>大家在聊</h2>
                </div>
                <span className="handwritten-mark">hot!</span>
              </div>
              <div className="hot-tag-list">
                {hotTags.length > 0 ? (
                  hotTags.map(([tag, count], index) => (
                    <button
                      key={tag}
                      onClick={() => setSearchQuery(tag)}
                      type="button"
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>#{tag}</strong>
                      <small>{count} 条</small>
                    </button>
                  ))
                ) : (
                  <p className="rail-empty">等第一批话题出现。</p>
                )}
              </div>
            </section>

            <section className="guide-card" id="wall-guide">
              <span className="paper-tape paper-tape-right" />
              <span className="eyebrow">A KIND WALL</span>
              <h2>让这里一直友善</h2>
              <p>说具体的话，给真诚的回应；失物信息解决后，记得更新状态。</p>
              <button onClick={() => setComposerOpen(true)} type="button">
                <PlusIcon size={17} />
                写一张便笺
              </button>
            </section>
          </aside>
        </div>
      </div>

      <button
        aria-label="发布便笺"
        className="mobile-compose-button"
        onClick={() => setComposerOpen(true)}
        type="button"
      >
        <PlusIcon size={22} />
      </button>

      {composerOpen ? (
        <ComposerDialog
          initialBoard={activeBoard}
          onClose={() => setComposerOpen(false)}
          onSubmit={handleCreatePost}
        />
      ) : null}

      {accountOpen ? (
        <AccountDialog
          onClose={() => setAccountOpen(false)}
          onContentChanged={() => void syncPosts()}
          onProfileUpdated={handleProfileUpdated}
        />
      ) : null}

      {reportTarget ? (
        <ReportDialog
          onClose={() => setReportTarget(null)}
          onSubmitted={() => announce("举报已提交，审核人员将按优先级处理")}
          postId={reportTarget.id}
          postTitle={reportTarget.title}
        />
      ) : null}

      {adminOpen ? (
        <AdminDialog
          onClose={() => setAdminOpen(false)}
          onContentChanged={() => void syncPosts()}
        />
      ) : null}

      <div aria-atomic="true" aria-live="polite" className="toast-region">
        {toastMessage ? (
          <div className="toast-message" role="status">
            <span aria-hidden="true">✓</span>
            {toastMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}
