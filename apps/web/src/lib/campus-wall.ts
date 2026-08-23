export const BOARD_IDS = [
  "news",
  "daily",
  "lost_found",
  "confession",
  "tree_hole",
] as const;

export type BoardId = (typeof BOARD_IDS)[number];

export type SortMode = "latest" | "popular" | "discussed";
export type ResolutionStatus = "open" | "resolved";
export type ResolutionFilter = "all" | ResolutionStatus;
export type LostFoundKind = "lost" | "found";
export type LostFoundCategory =
  | "documents"
  | "electronics"
  | "keys"
  | "clothing"
  | "books"
  | "other";
export type PublicationStatus = "draft" | "scheduled" | "published";

export const LOST_FOUND_CATEGORIES: readonly {
  id: LostFoundCategory;
  label: string;
}[] = [
  { id: "documents", label: "证件卡片" },
  { id: "electronics", label: "数码电子" },
  { id: "keys", label: "钥匙门禁" },
  { id: "clothing", label: "衣物配饰" },
  { id: "books", label: "书籍资料" },
  { id: "other", label: "其他物品" },
] as const;

export type BoardMeta = {
  id: BoardId;
  name: string;
  shortName: string;
  eyebrow: string;
  description: string;
};

export const BOARDS: readonly BoardMeta[] = [
  {
    id: "news",
    name: "校园资讯",
    shortName: "资讯",
    eyebrow: "CAMPUS NEWS",
    description: "通知、活动与值得知道的校园新鲜事",
  },
  {
    id: "daily",
    name: "校园日常",
    shortName: "日常",
    eyebrow: "DAILY LIFE",
    description: "分享今天路过的风景和小小发现",
  },
  {
    id: "lost_found",
    name: "失物招领",
    shortName: "失物",
    eyebrow: "LOST & FOUND",
    description: "让走散的物品快一点回到主人身边",
  },
  {
    id: "confession",
    name: "表白墙",
    shortName: "表白",
    eyebrow: "SAY IT OUT",
    description: "把感谢、欣赏和喜欢认真说出来",
  },
  {
    id: "tree_hole",
    name: "树洞",
    shortName: "树洞",
    eyebrow: "TREE HOLE",
    description: "匿名放下心事，也接住别人的情绪",
  },
] as const;

export type WallComment = {
  id: string;
  content: string;
  author_name: string;
  is_anonymous: boolean;
  can_edit?: boolean;
  parent_id?: string;
  depth?: number;
  likes_count?: number;
  liked?: boolean;
  edited_at?: string;
  created_at: string;
  time_label?: string;
};

export type PostMedia = {
  id: string;
  url: string;
  content_type: "image/jpeg" | "image/png" | "image/webp";
  byte_size: number;
  pixel_width?: number;
  pixel_height?: number;
  position: number;
};

export type WallPost = {
  id: string;
  category: BoardId;
  title?: string;
  content: string;
  tags: string[];
  author_name: string;
  author_badge?: string;
  is_anonymous: boolean;
  can_edit?: boolean;
  created_at: string;
  edited_at?: string;
  time_label?: string;
  likes_count: number;
  comment_count: number;
  comments: WallComment[];
  liked: boolean;
  bookmarked?: boolean;
  comments_enabled?: boolean;
  is_pinned?: boolean;
  location?: string;
  resolution_status?: ResolutionStatus;
  lost_found_type?: LostFoundKind;
  item_category?: LostFoundCategory;
  occurred_at?: string;
  publication_status?: PublicationStatus;
  scheduled_for?: string;
  media?: PostMedia[];
};

export type CreatePostInput = {
  category: BoardId;
  title?: string;
  content: string;
  tags: string[];
  is_anonymous: boolean;
  location?: string;
  lost_found_type?: LostFoundKind;
  item_category?: LostFoundCategory;
  occurred_at?: string;
  resolution_status?: ResolutionStatus;
  publication_status?: PublicationStatus;
  scheduled_for?: string;
  comments_enabled?: boolean;
  media_ids?: string[];
};

export type CreateCommentInput = {
  content: string;
  is_anonymous: boolean;
  parent_id?: string;
};

export type DataMode = "loading" | "live" | "demo";

export function getBoard(boardId: BoardId): BoardMeta {
  return BOARDS.find((board) => board.id === boardId) ?? BOARDS[0];
}

export function isBoardId(value: unknown): value is BoardId {
  return typeof value === "string" && BOARD_IDS.includes(value as BoardId);
}

