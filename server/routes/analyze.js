const express = require("express");
const router = express.Router();
const { chunkText } = require("../utils/chunker");
const { generateEmbeddings } = require("../utils/embeddings");
const {
  storeEmbeddings,
  hasEmbeddings,
  getContentHash,
  findByContentHash,
  getRawEmbeddings,
} = require("../utils/vectorStore");

/**
 * POST /analyze
 * Body: { url: string, content: string, contentHash?: string }
 * Chunks the page content, generates embeddings, and stores them.
 * Supports incremental indexing via content hash comparison.
 */
router.post("/", async (req, res) => {
  try {
    const { url, content, contentHash } = req.body;

    if (!url || !content) {
      return res.status(400).json({ error: "url and content are required" });
    }

    // If content hash provided, check if content is unchanged
    if (contentHash && hasEmbeddings(url)) {
      const existingHash = getContentHash(url);
      if (existingHash === contentHash) {
        return res.json({ status: "already_indexed", url });
      }
    }

    // Check if identical content exists under a different URL (cache reuse)
    if (contentHash) {
      const existingUrl = findByContentHash(contentHash);
      if (existingUrl && existingUrl !== url && hasEmbeddings(existingUrl)) {
        const cachedEmbeddings = getRawEmbeddings(existingUrl);
        if (cachedEmbeddings) {
          storeEmbeddings(url, cachedEmbeddings, contentHash);
          return res.json({ status: "already_indexed", url, cached: true });
        }
      }
    }

    // Chunk the content
    const chunks = chunkText(content);

    if (chunks.length === 0) {
      return res.status(400).json({ error: "No content to analyze" });
    }

    // Generate embeddings
    const allEmbeddings = [];
    const batchSize = 100;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchEmbeddings = await generateEmbeddings(batch);
      allEmbeddings.push(...batchEmbeddings);
    }

    // Determine if this is an update or new index
    const wasExisting = hasEmbeddings(url);

    // Store in vector store with content hash
    storeEmbeddings(url, allEmbeddings, contentHash);

    res.json({
      status: wasExisting ? "updated" : "indexed",
      url,
      chunks: chunks.length,
    });
  } catch (err) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: "Failed to analyze content" });
  }
});

module.exports = router;
