"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
import {
  createComment as postComment,
  createPost as postToApi,
  fetchPosts,
  toggleLike as toggleApiLike,
  updateResolution as updateApiResolution,
} from "@/lib/api";
import {
  BOARDS,
  getBoard,
  type BoardId,
  type CreatePostInput,
  type DataMode,
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

function EmptyFeed({ hasSearch, boardName }: { hasSearch: boolean; boardName: string }) {
  return (
    <div className="empty-feed">
      <span className="empty-note-pin" />
      <BoardIcon board="daily" size={30} />
      <h2>{hasSearch ? "没有找到相符的便笺" : `${boardName}还没有内容`}</h2>
      <p>{hasSearch ? "换个关键词，或清空筛选再看看。" : "来贴上第一张便笺，让这里热闹起来吧。"}</p>
    </div>
  );
}

export function CampusWall() {
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [dataMode, setDataMode] = useState<DataMode>("loading");
  const [isSyncing, setIsSyncing] = useState(true);
  const [activeBoard, setActiveBoard] = useState<BoardId>("news");
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [resolutionFilter, setResolutionFilter] = useState<ResolutionFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const requestControllerRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);

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
    } catch {
      if (controller.signal.aborted && requestControllerRef.current !== controller) {
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
  }, [syncPosts]);

  const switchToSessionMode = useCallback(() => {
    setDataMode("demo");
    announce("刚才的操作已保留，本次会话可以继续使用");
  }, [announce]);

  const boardCounts = useMemo(() => {
    return BOARDS.reduce<Record<BoardId, number>>(
      (counts, board) => {
        counts[board.id] = posts.filter((post) => post.category === board.id).length;
        return counts;
      },
      { news: 0, daily: 0, lost_found: 0, confession: 0, tree_hole: 0 },
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
    const result = posts.filter((post) => {
      if (post.category !== activeBoard) return false;
      if (
        activeBoard === "lost_found" &&
        resolutionFilter !== "all" &&
        (post.resolution_status ?? "open") !== resolutionFilter
      ) {
        return false;
      }
      if (!normalizedQuery) return true;

      const searchableText = [
        post.title,
        post.content,
        post.author_name,
        post.location,
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
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [activeBoard, deferredSearch, posts, resolutionFilter, sortMode]);

  async function handleCreatePost(input: CreatePostInput) {
    const now = new Date();
    const localId = `local-post-${now.getTime()}`;
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
        : "我",
      is_anonymous: input.is_anonymous,
      created_at: now.toISOString(),
      time_label: "刚刚",
      likes_count: 0,
      comment_count: 0,
      comments: [],
      liked: false,
      location: input.location,
      lost_found_type: input.lost_found_type,
      resolution_status: input.resolution_status,
    };

    if (dataMode === "loading") {
      const activeRequest = requestControllerRef.current;
      requestControllerRef.current = null;
      activeRequest?.abort();
      setDataMode("demo");
    }

    setPosts((current) => [
      localPost,
      ...(current.length > 0 ? current : DEMO_POSTS),
    ]);
    setActiveBoard(input.category);
    setResolutionFilter("all");
    announce(`已发布到${getBoard(input.category).name}`);

    if (dataMode !== "live") return;

    try {
      const savedPost = await postToApi(input);
      if (savedPost) {
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
    } catch {
      switchToSessionMode();
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
              likes_count: Math.max(0, post.likes_count + (post.liked ? -1 : 1)),
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
    } catch {
      switchToSessionMode();
    }
  }

  async function handleComment(
    postId: string,
    content: string,
    isAnonymous: boolean,
  ) {
    const now = new Date();
    const localCommentId = `local-comment-${now.getTime()}`;
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
    } catch {
      switchToSessionMode();
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
    announce(resolutionStatus === "resolved" ? "已标记为解决" : "这条失物信息已重新开启");

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
    } catch {
      switchToSessionMode();
    }
  }

  function chooseBoard(boardId: BoardId) {
    setActiveBoard(boardId);
    setResolutionFilter("all");
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
            <a aria-current="page" href="#main-feed">广场</a>
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
            <button className="primary-button header-publish" onClick={() => setComposerOpen(true)} type="button">
              <PlusIcon size={18} />
              <span>发布便笺</span>
            </button>
            <div aria-label="当前用户：观澜同学" className="user-avatar">观</div>
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
              <p>校园服务暂时不可用，发布、点赞和评论仍可使用，并保留到本次页面会话结束。</p>
            </div>
            <button disabled={isSyncing} onClick={() => void syncPosts()} type="button">
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
                      aria-current={activeBoard === board.id ? "page" : undefined}
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
                      <span className="board-count">{boardCounts[board.id]}</span>
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
              <span className="hero-post-count">{boardCounts[activeBoard]} 张便笺</span>
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
                  <button aria-label="清空搜索" onClick={() => setSearchQuery("")} type="button">
                    清空
                  </button>
                ) : null}
              </label>
              <label className="sort-field">
                <span className="sr-only">帖子排序方式</span>
                <select onChange={(event) => setSortMode(event.target.value as SortMode)} value={sortMode}>
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {activeBoard === "lost_found" ? (
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
                    key={post.id}
                    onComment={handleComment}
                    onLike={handleLike}
                    onResolutionChange={handleResolutionChange}
                    post={post}
                  />
                ))}
              </div>
            ) : (
              <EmptyFeed boardName={activeBoardMeta.name} hasSearch={Boolean(deferredSearch || resolutionFilter !== "all")} />
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
                    <button key={tag} onClick={() => setSearchQuery(tag)} type="button">
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
