/**
 * In-memory vector store keyed by URL.
 * Stores chunked embeddings per page and performs cosine similarity search.
 */

const store = new Map();    // url -> { embeddings, contentHash, timestamp }
const hashIndex = new Map(); // contentHash -> url (for dedup across URLs with same content)

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Store embeddings for a URL with content hash.
 * @param {string} url - Page URL as key
 * @param {{ chunk: string, embedding: number[] }[]} embeddings
 * @param {string} [contentHash] - Hash of the source content
 */
function storeEmbeddings(url, embeddings, contentHash) {
  store.set(url, {
    embeddings,
    contentHash: contentHash || null,
    timestamp: Date.now(),
  });
  if (contentHash) {
    hashIndex.set(contentHash, url);
  }
}

/**
 * Check if we already have embeddings for a URL.
 */
function hasEmbeddings(url) {
  return store.has(url);
}

/**
 * Get the content hash for a stored URL.
 */
function getContentHash(url) {
  const entry = store.get(url);
  return entry ? entry.contentHash : null;
}

/**
 * Check if content with a given hash is already indexed (possibly under a different URL).
 * Returns the URL if found, null otherwise.
 */
function findByContentHash(contentHash) {
  return hashIndex.get(contentHash) || null;
}

/**
 * Retrieve top-K most relevant chunks for a query embedding.
 * @param {string} url
 * @param {number[]} queryEmbedding
 * @param {number} topK
 * @returns {{ chunk: string, score: number }[]}
 */
function searchSimilar(url, queryEmbedding, topK = 5) {
  const entry = store.get(url);
  if (!entry) return [];

  const scored = entry.embeddings.map((item) => ({
    chunk: item.chunk,
    score: cosineSimilarity(queryEmbedding, item.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Get raw embeddings array for a URL (for cache reuse).
 */
function getRawEmbeddings(url) {
  const entry = store.get(url);
  return entry ? entry.embeddings : null;
}

/**
 * Remove embeddings for a URL (cleanup).
 */
function removeEmbeddings(url) {
  const entry = store.get(url);
  if (entry && entry.contentHash) {
    hashIndex.delete(entry.contentHash);
  }
  store.delete(url);
}

/**
 * Get number of stored pages.
 */
function getStoreSize() {
  return store.size;
}

module.exports = {
  storeEmbeddings,
  hasEmbeddings,
  getContentHash,
  findByContentHash,
  getRawEmbeddings,
  searchSimilar,
  removeEmbeddings,
  getStoreSize,
};
