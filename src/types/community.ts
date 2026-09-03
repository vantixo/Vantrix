// ── Community Types ───────────────────────────────────────────────────────────

export type CommunityType = "creator" | "general";

export type DiscussionSort = "trending" | "new" | "top";

export interface Community {
  slug:         string;
  name:         string;
  type:         CommunityType;
  description:  string;
  memberCount:  number;
  postCount:    number;
  imageUrl?:    string;
  bannerUrl?:   string;
}

export interface CommunityPost {
  id:            string;
  communitySlug: string;
  authorId:      string;
  authorName:    string;
  title:         string;
  body:          string;
  /** "discussion" | "fan-art" | "theory" | "tips" | "milestone" | "lore" | "question" */
  tag:           string;
  likesCount:    number;
  replyCount:    number;
  userLiked:     boolean;
  isPinned:      boolean;
  createdAt:     string;
}

export interface CommunityReply {
  id:         string;
  postId:     string;
  authorId:   string;
  authorName: string;
  body:       string;
  likesCount: number;
  userLiked:  boolean;
  createdAt:  string;
}
