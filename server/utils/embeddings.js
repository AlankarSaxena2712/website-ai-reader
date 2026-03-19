/**
 * Local TF-IDF based embeddings — no external API needed.
 * Works entirely in-memory for fast, free similarity search.
 */

// Shared vocabulary built during analysis
let vocabulary = new Map();
let idfValues = new Map();

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function buildVocabulary(chunks) {
  vocabulary = new Map();
  const docFreq = new Map();
  const totalDocs = chunks.length;

  // Count document frequency for each term
  for (const chunk of chunks) {
    const tokens = new Set(tokenize(chunk));
    for (const token of tokens) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  // Build vocabulary index and IDF values
  let idx = 0;
  for (const [term, df] of docFreq) {
    vocabulary.set(term, idx++);
    idfValues.set(term, Math.log((totalDocs + 1) / (df + 1)) + 1);
  }
}

function textToVector(text) {
  const tokens = tokenize(text);
  const termFreq = new Map();

  for (const token of tokens) {
    termFreq.set(token, (termFreq.get(token) || 0) + 1);
  }

  const vector = new Float64Array(vocabulary.size);
  for (const [term, tf] of termFreq) {
    const idx = vocabulary.get(term);
    if (idx !== undefined) {
      vector[idx] = tf * (idfValues.get(term) || 1);
    }
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  }

  return Array.from(vector);
}

/**
 * Generate embeddings for an array of text chunks.
 * Returns an array of { chunk, embedding } objects.
 */
async function generateEmbeddings(chunks) {
  buildVocabulary(chunks);
  return chunks.map((chunk) => ({
    chunk,
    embedding: textToVector(chunk),
  }));
}

/**
 * Generate embedding for a single query string.
 */
async function generateQueryEmbedding(query) {
  return textToVector(query);
}

module.exports = { generateEmbeddings, generateQueryEmbedding };
