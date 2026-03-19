const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const { generateQueryEmbedding } = require("../utils/embeddings");
const { searchSimilar, hasEmbeddings } = require("../utils/vectorStore");

const cerebras = new OpenAI({
  apiKey: process.env.CEREBRAS_API_KEY,
  baseURL: "https://api.cerebras.ai/v1",
});

/**
 * POST /ask
 * Body: { url: string, question: string, history?: { role: string, content: string }[] }
 * Retrieves relevant chunks and answers the question using Cerebras.
 */
router.post("/", async (req, res) => {
  try {
    const { url, question, history = [] } = req.body;

    if (!url || !question) {
      return res.status(400).json({ error: "url and question are required" });
    }

    if (!hasEmbeddings(url)) {
      return res.status(400).json({
        error: "Page not analyzed yet. Please analyze the page first.",
      });
    }

    // Generate embedding for the question
    const queryEmbedding = await generateQueryEmbedding(question);

    // Find top 5 relevant chunks
    const relevantChunks = searchSimilar(url, queryEmbedding, 5);
    const context = relevantChunks.map((c) => c.chunk).join("\n\n---\n\n");

    // Build messages for Cerebras (OpenAI-compatible format)
    const messages = [
      {
        role: "system",
        content: `You are a helpful assistant that answers questions about a webpage. Use ONLY the provided context to answer. If the answer is not in the context, say "I couldn't find that information on this page."

Context from the webpage:
${context}`,
      },
      ...history.slice(-10),
      {
        role: "user",
        content: question,
      },
    ];

    // Stream response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await cerebras.chat.completions.create({
      model: "llama3.1-8b",
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: 1024,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Ask error:", err);
    res.status(500).json({ error: "Failed to generate answer" });
  }
});

module.exports = router;
