"use client";

import { useCallback } from "react";
import type { CharacterWorldProfile } from "@/types/universe-views";
import type { TimelineEntry } from "@/lib/ai/timeline-engine";
import type { LifeChapter } from "@/lib/ai/life-story";

/**
 * Domain hook for everything on the character detail page that the
 * static/ISR-safe page shell can't fetch server-side per-user (like/follow
 * state, nickname customization) or that's genuinely optional secondary
 * content fetched on demand (World Profile, Our Story). Follows the same
 * plain-client-fetch shape as use-community.ts / use-dating-deck.ts — each
 * caller owns its own local state, this hook just wraps the fetch calls.
 */

export interface CharacterSocialStatus {
  liked: boolean;
  likeCount: number;
  following: boolean;
  followerCount: number;
}

export interface RelationshipNicknames {
  nicknameForUser: string | null;
  userNicknameForCharacter: string | null;
  customizedAt: string | null;
}

export interface CharacterStory {
  characterName: string;
  headline: string;
  timeline: TimelineEntry[];
  chapters: LifeChapter[];
}

export function useCharacterPage() {
  const getSocialStatus = useCallback(
    async (characterId: string): Promise<CharacterSocialStatus | null> => {
      const [likeRes, followRes] = await Promise.all([
        fetch(`/api/characters/${characterId}/like`),
        fetch(`/api/characters/${characterId}/follow`),
      ]);
      if (!likeRes.ok || !followRes.ok) return null;
      const [like, follow] = await Promise.all([likeRes.json(), followRes.json()]);
      return {
        liked: like.liked,
        likeCount: like.likeCount,
        following: follow.following,
        followerCount: follow.followerCount,
      };
    },
    []
  );

  const toggleLike = useCallback(
    async (characterId: string): Promise<{ liked: boolean; likeCount: number } | null> => {
      const res = await fetch(`/api/characters/${characterId}/like`, { method: "POST" });
      if (!res.ok) return null;
      return res.json();
    },
    []
  );

  const toggleFollow = useCallback(
    async (characterId: string): Promise<{ following: boolean; followerCount: number } | null> => {
      const res = await fetch(`/api/characters/${characterId}/follow`, { method: "POST" });
      if (!res.ok) return null;
      return res.json();
    },
    []
  );

  const getRelationship = useCallback(
    async (characterId: string): Promise<FetchResult<RelationshipNicknames>> => {
      const res = await fetch(`/api/characters/${characterId}/relationship`);
      if (res.status === 401) return { status: "unauthorized" };
      if (!res.ok) return { status: "error" };
      return { status: "ok", data: (await res.json()) as RelationshipNicknames };
    },
    []
  );

  const updateRelationship = useCallback(
    async (
      characterId: string,
      patch: { nicknameForUser?: string | null; userNicknameForCharacter?: string | null }
    ): Promise<boolean> => {
      const res = await fetch(`/api/characters/${characterId}/relationship`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      return res.ok;
    },
    []
  );

  // World Profile and Our Story both require auth (character_relationships /
  // universe rows are per-user) — distinguish "sign in to see this" from a
  // real fetch failure so the UI doesn't show a misleading error state to
  // an anonymous visitor just browsing a character page.
  const getWorldProfile = useCallback(
    async (characterId: string): Promise<FetchResult<CharacterWorldProfile>> => {
      const res = await fetch(`/api/universe/profile?characterId=${characterId}`);
      if (res.status === 401) return { status: "unauthorized" };
      if (!res.ok) return { status: "error" };
      const body = await res.json();
      return { status: "ok", data: body.profile as CharacterWorldProfile };
    },
    []
  );

  const getStory = useCallback(
    async (characterId: string): Promise<FetchResult<CharacterStory>> => {
      const res = await fetch(`/api/characters/${characterId}/story`);
      if (res.status === 401) return { status: "unauthorized" };
      if (!res.ok) return { status: "error" };
      return { status: "ok", data: (await res.json()) as CharacterStory };
    },
    []
  );

  return {
    getSocialStatus,
    toggleLike,
    toggleFollow,
    getRelationship,
    updateRelationship,
    getWorldProfile,
    getStory,
  };
}

export type FetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "unauthorized" }
  | { status: "error" };
