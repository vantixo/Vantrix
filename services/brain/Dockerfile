# Vantrix Brain — semantic memory reranking service
# CPU-only image. all-MiniLM-L6-v2 is ~90MB and runs fine without a GPU at
# the request volumes a per-message rerank call implies.

FROM python:3.11-slim

WORKDIR /app

# torch CPU wheel via sentence-transformers' default index is large; using
# the official CPU-only index keeps the image meaningfully smaller.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Bake the model into the image at build time so container start isn't
# blocked on a first-request download (and so this never depends on
# huggingface.co being reachable at runtime).
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=3).read()" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
