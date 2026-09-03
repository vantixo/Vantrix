// src/lib/image/providers/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Provider-agnostic image-generation contract. Every adapter (HotAPI, Atlas,
// and any future one) implements this and nothing else — call sites
// (primary-image.ts, the image-router) only ever depend on this interface,
// never on a provider's own request/response shape. Mirrors the
// LLMProvider-style separation used in lib/ai/provider-router.ts.

export interface ImageGenerationInput {
  prompt:          string;
  negativePrompt?: string;
  imageSize?:      'portrait_4_3' | 'square' | 'landscape_16_9' | 'portrait_16_9';
  seed?:           number;
  allowMature?:    boolean;
}

export interface ImageGenerationResult {
  success:     boolean;
  imageUrl?:   string;
  error?:      string;
  /** HTTP status from the provider, when available — used to distinguish
   *  an outage (5xx/timeout, worth failing over) from a content-policy
   *  rejection (4xx, NOT worth retrying on a different provider). */
  statusCode?: number;
}

export interface ImageProvider {
  readonly name: string;
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}
