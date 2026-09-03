"use client";

import { Component, type ReactNode } from "react";

/**
 * useGLTF's load failures (404, a corrupt/non-glTF file at model_url,
 * decode errors) throw *real* errors, not the "still loading" promise
 * Suspense is built to catch — Suspense only handles the latter. Without
 * this, one bad model_url would trip (app)/error.tsx and take out the
 * whole character page, the same failure mode SafeImage
 * (safe-image.tsx) already exists to prevent for 2D images. This is that
 * same fallback-on-error philosophy applied to the 3D viewer: catch here,
 * render the 2D portrait instead, and get on with the page.
 *
 * A class component because React doesn't have a hook-based error
 * boundary API — this is the one place in the immersive/ folder that
 * isn't a function component for exactly that reason.
 */
export class Character3DErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console -- intentional: a silent 3D
    // failure with no signal anywhere would make a broken model_url
    // invisible until someone happens to notice the fallback rendering.
    console.error("[Character3D] falling back to 2D portrait:", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
