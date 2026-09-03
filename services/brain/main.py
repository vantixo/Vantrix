"""
Vantrix Brain — Python Semantic Intelligence Service
─────────────────────────────────────────────────────────────────────────────
What this replaces:
  memory-graph.ts today ranks a character's memories purely by
  `emotional_weight` + recency. emotion-state.ts's applyEmotionBias() nudges
  that order using a hardcoded emotion→event-type affinity table. Both are
  rule-based — neither one looks at what the user actually just said. Two
  memories with identical weight/recency are indistinguishable to them even
  if only one is relevant to the current message.

What this adds:
  A real embedding model (sentence-transformers/all-MiniLM-L6-v2 — free,
  22M params, runs on CPU, ~90MB) that embeds the user's current message and
  each candidate memory, then ranks memories by cosine similarity. This is
  the "vector search" referenced in emotion-state.ts's own comment
  ("the practical, zero-infra equivalent of v20 MemoryEngine's emotionBias
  parameter on vector search") — this service is the non-zero-infra version
  of that same idea, done properly.

Design:
  - Single small model, loaded once at startup, kept in memory.
  - Stateless HTTP service — Node calls it per-request with a short timeout
    and MUST fail open (fall back to the existing emotion/recency order) if
    this service is slow, down, or erroring. It should make replies better
    when healthy, never worse or blocking when it isn't.
  - No external network calls at request time — the model is downloaded
    once (at image build or first container start) and inference is fully
    local, so this adds zero per-request API cost.

Run locally:
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000

Run in Docker: see Dockerfile in this directory.
"""

import os
import time
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.environ.get("BRAIN_MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")
MAX_CANDIDATES = 100  # hard cap so a bad request can't force a huge batch encode

# AUTH-FIX (P1): this service was insecure-by-default — if
# BRAIN_SERVICE_API_KEY was unset, /embed and /rerank were fully open to
# anyone who could reach the URL, and docker-compose published it on the
# host's 8000 by default, so a self-hosted deploy could end up exposing a
# CPU-intensive ML endpoint to the public internet with zero credential
# required. Auth is now mandatory: the service refuses to start without a
# key, unless BRAIN_SERVICE_DEV_MODE=true is explicitly set (local dev only
# — never set this in any deployed environment). /health stays open (no
# sensitive work happens there, and load balancers/orchestrators often need
# to hit it without credentials).
API_KEY = os.environ.get("BRAIN_SERVICE_API_KEY")
DEV_MODE = os.environ.get("BRAIN_SERVICE_DEV_MODE", "").lower() == "true"

if not API_KEY and not DEV_MODE:
    raise RuntimeError(
        "BRAIN_SERVICE_API_KEY is required. This service performs "
        "unauthenticated-by-default ML inference and must not be started "
        "without a key. For local development only, set "
        "BRAIN_SERVICE_DEV_MODE=true instead — never in a deployed "
        "environment, and never alongside a publicly published port."
    )

app = FastAPI(title="Vantrix Brain", version="1.0.0")


def _require_auth(authorization: Optional[str]) -> None:
    if DEV_MODE and not API_KEY:
        return  # explicit opt-in, local dev only
    expected = f"Bearer {API_KEY}"
    if not authorization or authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


_model: Optional[SentenceTransformer] = None
_model_load_error: Optional[str] = None
_loaded_at: Optional[float] = None


@app.on_event("startup")
def load_model() -> None:
    global _model, _model_load_error, _loaded_at
    try:
        _model = SentenceTransformer(MODEL_NAME)
        _loaded_at = time.time()
    except Exception as exc:  # noqa: BLE001 — startup diagnostics, not request handling
        # Don't crash the process — /health will report unhealthy and Node's
        # circuit breaker will trip and fail open. A half-broken service that
        # reports its own state honestly is safer than one that crash-loops.
        _model_load_error = str(exc)


# ── Schemas ──────────────────────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=MAX_CANDIDATES)


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    model: str


class MemoryCandidate(BaseModel):
    id: str
    text: str


class RerankRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    candidates: List[MemoryCandidate] = Field(..., min_length=1, max_length=MAX_CANDIDATES)


class RankedResult(BaseModel):
    id: str
    score: float  # cosine similarity, -1..1 (in practice ~0..1 for this model)


class RerankResponse(BaseModel):
    ranked: List[RankedResult]  # sorted descending by score
    model: str
    latency_ms: float


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    if _model is None:
        return {
            "ok": False,
            "model_loaded": False,
            "error": _model_load_error,
        }
    return {
        "ok": True,
        "model_loaded": True,
        "model": MODEL_NAME,
        "loaded_at": _loaded_at,
    }


def _require_model() -> SentenceTransformer:
    if _model is None:
        # 503, not 500 — this is "temporarily unavailable", exactly the signal
        # Node's circuit breaker should treat as a trip-and-fail-open case.
        raise HTTPException(status_code=503, detail="model not loaded")
    return _model


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest, authorization: Optional[str] = Header(default=None)):
    _require_auth(authorization)
    model = _require_model()
    vectors = model.encode(req.texts, normalize_embeddings=True)
    return EmbedResponse(embeddings=vectors.tolist(), model=MODEL_NAME)


@app.post("/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest, authorization: Optional[str] = Header(default=None)):
    """
    Embeds the query and every candidate's text in one batch, scores each
    candidate by cosine similarity to the query, and returns them sorted
    descending. Embeddings are L2-normalized so cosine similarity reduces to
    a dot product — cheap once encoding is done.
    """
    _require_auth(authorization)
    model = _require_model()
    start = time.perf_counter()

    texts = [req.query] + [c.text for c in req.candidates]
    vectors = model.encode(texts, normalize_embeddings=True)

    query_vec = vectors[0]
    candidate_vecs = vectors[1:]

    scores = candidate_vecs @ query_vec  # dot product == cosine sim (normalized)

    ranked = sorted(
        (
            RankedResult(id=c.id, score=float(s))
            for c, s in zip(req.candidates, scores)
        ),
        key=lambda r: r.score,
        reverse=True,
    )

    latency_ms = (time.perf_counter() - start) * 1000
    return RerankResponse(ranked=ranked, model=MODEL_NAME, latency_ms=latency_ms)
