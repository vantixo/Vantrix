// src/lib/video/providers/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Provider-agnostic video-generation contract. Every adapter (HotAPI, Atlas)
// implements this and nothing else — call sites (video-router.ts, and
// through it the chat video route + content-engine) only ever depend on
// this interface, never on a provider's own request/response shape.
// Mirrors providers/types.ts in lib/image, but video is asynchronous:
// submit() returns a task id immediately, getStatus() is polled until the
// job reaches a terminal state.
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoGenerationInput {
  /** Source still image to animate — image-to-video. */
  imageUrl: string;
  /** Motion/scene description. */
  prompt: string;
  negativePrompt?: string;
  /** Clip length in seconds. */
  durationSeconds?: '5' | '10';
  /** 'std' (cheaper) or 'pro' (higher quality, higher cost). */
  mode?: 'std' | 'pro';
}

export interface VideoSubmitResult {
  success: boolean;
  taskId?: string;
  error?: string;
  /** HTTP status from the provider, when available — used to distinguish
   *  an outage (5xx/timeout, worth failing over) from a content-policy
   *  rejection (4xx, NOT worth retrying on a different provider). */
  statusCode?: number;
}

export interface VideoTaskStatus {
  /**
   * 'check_error' — the status *check itself* failed (network blip,
   * provider 5xx/429, timeout) — the underlying generation may still be
   * running fine. Distinct from 'failed', which means the provider told us
   * the task genuinely failed. Callers should treat this like 'processing'
   * (keep polling) rather than a terminal state.
   */
  status: 'submitted' | 'processing' | 'succeed' | 'failed' | 'check_error';
  videoUrl?: string;
  error?: string;
}

export interface VideoProvider {
  readonly name: string;
  submit(input: VideoGenerationInput): Promise<VideoSubmitResult>;
  getStatus(taskId: string): Promise<VideoTaskStatus>;
}
