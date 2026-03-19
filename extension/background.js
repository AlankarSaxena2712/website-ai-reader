/**
 * Background service worker.
 * Handles analysis requests and chat history per tab.
 */

const API_BASE = "https://api.aiwebreader.geekytwin.com";

// Store analysis state, content hashes, and chat history per URL
const analyzedTabs = new Map();  // url -> { contentHash, tabIds: Set }
const chatHistories = new Map(); // url -> history[]

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeContent") {
    handleAnalyze(request.url, request.content)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (request.action === "getAnalysisStatus") {
    const entry = analyzedTabs.get(request.url);
    sendResponse({
      analyzed: !!entry,
      contentHash: entry?.contentHash || null,
    });
    return true;
  }

  if (request.action === "setAnalyzed") {
    const tabId = sender.tab?.id;
    const existing = analyzedTabs.get(request.url) || { tabIds: new Set() };
    existing.contentHash = request.contentHash || existing.contentHash;
    if (tabId) existing.tabIds.add(tabId);
    analyzedTabs.set(request.url, existing);
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "saveChatHistory") {
    chatHistories.set(request.url, request.history);
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "getChatHistory") {
    sendResponse({ history: chatHistories.get(request.url) || [] });
    return true;
  }
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [url, entry] of analyzedTabs) {
    if (entry.tabIds) {
      entry.tabIds.delete(tabId);
      // If no tabs reference this URL, clean up after a delay
      if (entry.tabIds.size === 0) {
        setTimeout(() => {
          const current = analyzedTabs.get(url);
          if (current && current.tabIds.size === 0) {
            analyzedTabs.delete(url);
            chatHistories.delete(url);
          }
        }, 60000); // Keep for 60s in case user reopens
      }
    }
  }
});

// Toggle widget when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "toggleWidget" });
  } catch {
    // Content script not loaded yet — inject it
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  }
});

async function handleAnalyze(url, content) {
  try {
    const response = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, content }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Analysis failed");
    }

    const result = await response.json();
    analyzedTabs.set(url, true);
    return result;
  } catch (err) {
    throw new Error(`Failed to analyze: ${err.message}`);
  }
}
