"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseThoughtSegments } from "@/lib/chat/parse-thought-segments";

/**
 * Mirrors POST /api/voice/tts's documented response shapes (see that
 * route's own docstring):
 *   200 { mode: 'audio', audioUrl, mimeType, tone, tokenCost, cached }
 *   200 { mode: 'speech-synthesis', text, speechParams, tone, tokenCost }
 *   401 { error, code: 'UNAUTHORIZED' }
 *   402 { error, code: 'INSUFFICIENT_TOKENS', tokensRequired }
 *   400 { error, code: 'VALIDATION_ERROR' | 'EMPTY_TEXT' }
 *
 * One playback at a time app-wide: starting a new message stops whatever
 * was already playing (audio element or speechSynthesis utterance) rather
 * than layering voices. State is keyed by messageId so any number of
 * MessageBubbles can share this one hook instance's playingId to know
 * whether *they* are the one currently playing.
 *
 * play() is given the message's raw content, which — per parse-thought-
 * segments.ts — may contain [thought]...[/thought] (hidden interiority)
 * and [action]...[/action] (narration, rendered distinctly, not something
 * the character says aloud) alongside the spoken reply. Only the `speech`
 * segments are sent to the TTS route; thought/action text never reaches
 * the speech API, matching how the bubble already renders them.
 *
 * play() takes an optional 4th `voiceId` argument, threaded straight into
 * the request body as the route's explicit-voiceId override (see that
 * route's own docstring, priority #1). Normal chat playback never passes
 * it — MessageBubble/chat-window only ever call play(id, text, characterId)
 * — but the Studio voice picker uses it to audition a candidate voice
 * before it's saved to the character, reusing this same hook instance
 * (and its cache/circuit-breaker/fallback handling) instead of
 * duplicating the audio-playback logic.
 */

interface SpeechParams {
  rate: number;
  pitch: number;
  lang: string;
  voiceHint: "female-soft" | "female-warm" | "female-assertive" | "male-warm" | "male-deep";
}

interface TtsResponse {
  mode: "audio" | "speech-synthesis";
  audioUrl?: string;
  mimeType?: string;
  text?: string;
  speechParams?: SpeechParams;
  tone?: string;
  tokenCost?: number;
  error?: string;
  code?: string;
  tokensRequired?: number;
}

// Rough hint -> a browser voice actually available via speechSynthesis.
// getVoices() is async/inconsistent across browsers, so this only ever
// narrows by name substring on whatever list is already loaded; falling
// through to the browser's default voice for the given lang is fine.
function pickVoice(hint: SpeechParams["voiceHint"]): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const wantsFemale = hint.startsWith("female");
  const byName = voices.find((v) =>
    wantsFemale
      ? /female|samantha|victoria|zira|karen/i.test(v.name)
      : /male|daniel|alex|fred|david/i.test(v.name)
  );
  return byName ?? voices.find((v) => v.lang.startsWith("en")) ?? voices[0] ?? null;
}

export function useVoicePlayback() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setPlayingId(null);
  }, []);

  // Stop any in-flight audio/speech if the component using this hook
  // unmounts mid-playback (navigating away from the conversation).
  useEffect(() => () => stop(), [stop]);

  const play = useCallback(
    async (messageId: string, text: string, characterId: string, voiceId?: string) => {
      // Tapping the currently-playing message's button again pauses it.
      if (playingId === messageId) {
        stop();
        return;
      }

      // Strip [thought]/[action] markup (and bare *action* asides, which
      // parseThoughtSegments normalizes the same way) before this ever
      // reaches the speech API — only what the bubble renders as spoken
      // dialogue should be spoken aloud.
      const speechText = parseThoughtSegments(text)
        .filter((segment) => segment.type === "speech")
        .map((segment) => segment.text)
        .join(" ")
        .trim();

      if (!speechText) {
        setError("Nothing to speak.");
        return;
      }

      stop();
      setError(null);
      setLoadingId(messageId);

      try {
        const res = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            voiceId ? { text: speechText, characterId, voiceId } : { text: speechText, characterId }
          ),
        });
        const body = (await res.json().catch(() => null)) as TtsResponse | null;

        if (!res.ok || !body) {
          setError(
            body?.code === "INSUFFICIENT_TOKENS"
              ? `Need ${body.tokensRequired ?? "more"} VC to play voice.`
              : body?.error ?? "Couldn't play voice message."
          );
          return;
        }

        if (body.mode === "audio" && body.audioUrl) {
          const audio = new Audio(body.audioUrl);
          audioRef.current = audio;
          audio.addEventListener("ended", () => {
            if (audioRef.current === audio) {
              audioRef.current = null;
              setPlayingId((cur) => (cur === messageId ? null : cur));
            }
          });
          audio.addEventListener("error", () => {
            if (audioRef.current === audio) {
              audioRef.current = null;
              setPlayingId((cur) => (cur === messageId ? null : cur));
              setError("Voice playback failed.");
            }
          });
          await audio.play();
          setPlayingId(messageId);
        } else if (body.mode === "speech-synthesis" && body.speechParams && body.text) {
          if (typeof window === "undefined" || !window.speechSynthesis) {
            setError("Voice isn't supported in this browser.");
            return;
          }
          const utterance = new SpeechSynthesisUtterance(body.text);
          utterance.rate = body.speechParams.rate;
          utterance.pitch = body.speechParams.pitch;
          utterance.lang = body.speechParams.lang;
          const voice = pickVoice(body.speechParams.voiceHint);
          if (voice) utterance.voice = voice;
          utterance.onend = () => {
            utteranceRef.current = null;
            setPlayingId((cur) => (cur === messageId ? null : cur));
          };
          utterance.onerror = () => {
            utteranceRef.current = null;
            setPlayingId((cur) => (cur === messageId ? null : cur));
            setError("Voice playback failed.");
          };
          utteranceRef.current = utterance;
          window.speechSynthesis.speak(utterance);
          setPlayingId(messageId);
        } else {
          setError("Nothing to play.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't play voice message.");
      } finally {
        setLoadingId((cur) => (cur === messageId ? null : cur));
      }
    },
    [playingId, stop]
  );

  return { play, stop, playingId, loadingId, error, clearError: () => setError(null) };
}
