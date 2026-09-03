// ── Feed Types ──────────────────────────────────────────────────────────────
// Mirrors GET /api/feed/posts / .../like / .../comments response shapes
// exactly (see route.ts comments) — kept snake_case, unlike types/community.ts's
// camelCase, since these routes return raw table rows with a joined
// `character` object rather than a normalized DTO, and there's no
// intermediate mapping layer to rename fields through.

export type FeedFilter = "new" | "trending" | "all";

export interface FeedCharacterSummary {
  id: string;
  name: string;
  image_url: string | null;
  gender: string | null;
  tags: string[] | null;
  is_live: boolean | null;
  /** Same fields /api/discover/featured selects — feeds FeedStoriesRail's story viewer. */
  intro_video_url: string | null;
  gallery_image_urls: string[] | null;
  gallery_video_urls: string[] | null;
}

export interface FeedPost {
  id: string;
  caption: string | null;
  /** Redacted to null server-side when is_locked — see route.ts's SEC/MONETIZATION FIX. */
  image_url: string | null;
  post_type: "photo" | "text" | "teaser";
  is_locked: boolean;
  likes_count: number;
  comments_count: number;
  created_at: string;
  character: FeedCharacterSummary | null;
  user_liked: boolean;
}

export interface FeedPostsPage {
  posts: FeedPost[];
  nextCursor: string | null;
}

export interface FeedCommentAuthor {
  type: "user" | "character";
  id: string;
  name: string | null;
  image_url: string | null;
}

export interface FeedComment {
  id: string;
  content: string;
  created_at: string;
  author: FeedCommentAuthor;
}

export interface FeedCommentsPage {
  comments: FeedComment[];
  nextCursor: string | null;
}

export interface FeedLikeResult {
  liked: boolean;
  likes_count: number;
}
