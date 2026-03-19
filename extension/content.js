/**
 * Content script: extracts page content and injects the floating chat widget.
 */

const API_BASE = "http://localhost:3000";

// ============ PAGE CONTENT EXTRACTION ============

function extractPageContent() {
  const clone = document.body.cloneNode(true);

  const selectorsToRemove = [
    "nav", "footer", "header", "aside", "script", "style", "noscript", "iframe",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    ".ad", ".ads", ".advertisement", ".sidebar", ".nav", ".footer", ".header",
    ".cookie-banner", ".popup", ".modal",
    "#ai-web-reader-widget", "#ai-web-reader-fab",
  ];

  selectorsToRemove.forEach((selector) => {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  });

  let text = clone.innerText || clone.textContent || "";
  text = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).join("\n");
  return text;
}

// ============ STATE ============

let isWidgetOpen = false;
let isAnalyzed = false;
let chatHistory = [];
let currentUrl = window.location.href;
let lastContentHash = null;
let mutationDebounceTimer = null;
let urlCheckInterval = null;
let isReindexing = false;

// ============ FLOATING ACTION BUTTON ============

function createFAB() {
  const fab = document.createElement("div");
  fab.id = "ai-web-reader-fab";
  fab.innerHTML = `<img src="${chrome.runtime.getURL('icons/logo.png')}" style="width:28px;height:28px;" alt="AI Web Reader">`;
  document.body.appendChild(fab);

  fab.addEventListener("click", () => {
    toggleWidget();
  });

  return fab;
}

// ============ WIDGET ============

function createWidget() {
  const widget = document.createElement("div");
  widget.id = "ai-web-reader-widget";
  widget.classList.add("ai-wr-closed");

  widget.innerHTML = `
    <div class="ai-wr-header">
      <span class="ai-wr-title"><img src="${chrome.runtime.getURL('icons/logo.png')}" style="width:20px;height:20px;vertical-align:middle;margin-right:6px;" alt="">AI Web Reader</span>
      <div class="ai-wr-header-actions">
        <span class="ai-wr-status" id="ai-wr-status">Ready</span>
        <button class="ai-wr-minimize" id="ai-wr-minimize" title="Minimize">─</button>
        <button class="ai-wr-close" id="ai-wr-close" title="Close">✕</button>
      </div>
    </div>

    <div class="ai-wr-body">
      <div class="ai-wr-analyze" id="ai-wr-analyze">
        <button class="ai-wr-btn ai-wr-btn-primary" id="ai-wr-analyze-btn">
          📄 Analyze This Page
        </button>
        <p class="ai-wr-hint">Extract and index page content for AI chat</p>
      </div>

      <div class="ai-wr-chat hidden" id="ai-wr-chat">
        <div class="ai-wr-messages" id="ai-wr-messages"></div>

        <div class="ai-wr-quick-actions" id="ai-wr-quick-actions">
          <button class="ai-wr-btn ai-wr-btn-small" data-action="summarize">📝 Summarize</button>
          <button class="ai-wr-btn ai-wr-btn-small" data-action="keypoints">🔑 Key Points</button>
          <button class="ai-wr-btn ai-wr-btn-small" data-action="eli5">🧒 ELI5</button>
        </div>

        <div class="ai-wr-input-area">
          <textarea id="ai-wr-input" placeholder="Ask anything about this page..." rows="2"></textarea>
          <button class="ai-wr-btn ai-wr-btn-send" id="ai-wr-send" title="Send">➤</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(widget);
  return widget;
}

// ============ WIDGET LOGIC ============

function toggleWidget() {
  const widget = document.getElementById("ai-web-reader-widget");
  const fab = document.getElementById("ai-web-reader-fab");

  if (isWidgetOpen) {
    widget.classList.add("ai-wr-closed");
    fab.classList.remove("ai-wr-fab-hidden");
    isWidgetOpen = false;
  } else {
    widget.classList.remove("ai-wr-closed");
    fab.classList.add("ai-wr-fab-hidden");
    isWidgetOpen = true;
  }
}

function initWidgetEvents() {
  const analyzeBtn = document.getElementById("ai-wr-analyze-btn");
  const closeBtn = document.getElementById("ai-wr-close");
  const minimizeBtn = document.getElementById("ai-wr-minimize");
  const sendBtn = document.getElementById("ai-wr-send");
  const input = document.getElementById("ai-wr-input");

  closeBtn.addEventListener("click", toggleWidget);
  minimizeBtn.addEventListener("click", toggleWidget);

  analyzeBtn.addEventListener("click", () => handleAnalyze(false));

  sendBtn.addEventListener("click", () => sendMessage());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Quick actions
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prompts = {
        summarize: "Please provide a concise summary of this page.",
        keypoints: "What are the key points and main takeaways from this page?",
        eli5: "Explain the content of this page like I'm 5 years old.",
      };
      document.getElementById("ai-wr-input").value = prompts[btn.dataset.action];
      sendMessage();
    });
  });
}

// ============ ANALYZE ============

// ============ CONTENT HASHING ============

async function hashContent(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============ ANALYZE ============

async function handleAnalyze(silent = false) {
  const btn = document.getElementById("ai-wr-analyze-btn");
  if (!silent) {
    btn.disabled = true;
    btn.textContent = "⏳ Analyzing...";
  }
  setStatus("Extracting...", "analyzing");

  try {
    const content = extractPageContent();
    if (!content || content.length < 50) {
      throw new Error("Not enough content on this page");
    }

    const contentHash = await hashContent(content);

    // Skip if content hasn't changed
    if (contentHash === lastContentHash && isAnalyzed) {
      setStatus("Ready", "ready");
      if (!silent) {
        btn.disabled = false;
        btn.textContent = "📄 Analyze This Page";
      }
      return;
    }

    setStatus("Indexing...", "analyzing");

    const response = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: currentUrl, content, contentHash }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Analysis failed");
    }

    const result = await response.json();
    isAnalyzed = true;
    lastContentHash = contentHash;

    // Store status in background
    chrome.runtime.sendMessage({ action: "setAnalyzed", url: currentUrl, contentHash });

    showChat();
    if (result.status === "already_indexed") {
      if (!silent) addSystemMessage("Page already analyzed. Ask me anything!");
    } else if (result.status === "updated") {
      addSystemMessage(`Page content updated & re-indexed (${result.chunks} chunks).`);
    } else {
      const info = result.chunks ? ` (${result.chunks} chunks)` : "";
      addSystemMessage(`Page analyzed${info}. Ask me anything!`);
    }
    setStatus("Ready", "ready");
  } catch (err) {
    setStatus("Error", "error");
    if (!silent) addSystemMessage("Error: " + err.message);
    btn.disabled = false;
    btn.textContent = "📄 Analyze This Page";
  }
}

// ============ CHAT ============

async function sendMessage(overrideText) {
  const input = document.getElementById("ai-wr-input");
  const question = overrideText || input.value.trim();
  if (!question) return;

  input.value = "";
  addMessage(question, "user");

  const sendBtn = document.getElementById("ai-wr-send");
  sendBtn.disabled = true;

  const typingEl = addTypingIndicator();

  try {
    const response = await fetch(`${API_BASE}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: currentUrl,
        question,
        history: chatHistory,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Failed to get answer");
    }

    typingEl.remove();
    const msgEl = addMessage("", "assistant");
    let fullResponse = "";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              fullResponse += data.content;
              msgEl.textContent = fullResponse;
              scrollToBottom();
            }
          } catch { /* skip */ }
        }
      }
    }

    chatHistory.push({ role: "user", content: question });
    chatHistory.push({ role: "assistant", content: fullResponse });

    // Persist chat history
    chrome.runtime.sendMessage({
      action: "saveChatHistory",
      url: currentUrl,
      history: chatHistory,
    });
  } catch (err) {
    typingEl.remove();
    addSystemMessage("Error: " + err.message);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// ============ CONTEXT HIGHLIGHT (Select text → ask) ============

function initTextSelection() {
  let selectionTooltip = null;

  document.addEventListener("mouseup", (e) => {
    // Don't trigger inside the widget
    if (e.target.closest("#ai-web-reader-widget") || e.target.closest("#ai-web-reader-fab")) return;

    const selection = window.getSelection();
    const text = selection.toString().trim();

    // Remove old tooltip
    if (selectionTooltip) {
      selectionTooltip.remove();
      selectionTooltip = null;
    }

    if (text.length < 5 || !isAnalyzed) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    selectionTooltip = document.createElement("div");
    selectionTooltip.id = "ai-wr-selection-tooltip";
    selectionTooltip.innerHTML = `<button id="ai-wr-ask-selected"><img src="${chrome.runtime.getURL('icons/logo.png')}" style="width:16px;height:16px;vertical-align:middle;margin-right:4px;" alt="">Ask about this</button>`;
    selectionTooltip.style.top = `${window.scrollY + rect.top - 40}px`;
    selectionTooltip.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;
    document.body.appendChild(selectionTooltip);

    document.getElementById("ai-wr-ask-selected").addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Open widget if closed
      if (!isWidgetOpen) toggleWidget();

      const prompt = `Regarding this selected text: "${text.slice(0, 300)}"\n\nPlease explain this in detail.`;
      sendMessage(prompt);

      if (selectionTooltip) {
        selectionTooltip.remove();
        selectionTooltip = null;
      }
      window.getSelection().removeAllRanges();
    });
  });

  document.addEventListener("mousedown", (e) => {
    if (selectionTooltip && !e.target.closest("#ai-wr-selection-tooltip")) {
      selectionTooltip.remove();
      selectionTooltip = null;
    }
  });
}

// ============ UI HELPERS ============

function showChat() {
  document.getElementById("ai-wr-analyze").classList.add("hidden");
  document.getElementById("ai-wr-chat").classList.remove("hidden");
}

function setStatus(text, type) {
  const el = document.getElementById("ai-wr-status");
  el.textContent = text;
  el.className = "ai-wr-status" + (type ? " ai-wr-status-" + type : "");
}

function addMessage(content, role) {
  const messages = document.getElementById("ai-wr-messages");
  const el = document.createElement("div");
  el.className = `ai-wr-message ai-wr-message-${role}`;
  el.textContent = content;
  messages.appendChild(el);
  scrollToBottom();
  return el;
}

function addSystemMessage(text) {
  return addMessage(text, "system");
}

function addTypingIndicator() {
  const messages = document.getElementById("ai-wr-messages");
  const el = document.createElement("div");
  el.className = "ai-wr-message ai-wr-message-assistant ai-wr-typing";
  el.innerHTML = "<span></span><span></span><span></span>";
  messages.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  const messages = document.getElementById("ai-wr-messages");
  messages.scrollTop = messages.scrollHeight;
}

// ============ LISTEN FOR MESSAGES FROM POPUP/BACKGROUND ============

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "extractContent") {
    sendResponse({
      content: extractPageContent(),
      url: window.location.href,
      title: document.title,
    });
  }

  if (request.action === "toggleWidget") {
    toggleWidget();
    sendResponse({ ok: true });
  }

  if (request.action === "restoreChatHistory") {
    if (request.history && request.history.length > 0) {
      chatHistory = request.history;
      isAnalyzed = true;
      showChat();
      setStatus("Ready", "ready");

      request.history.forEach((msg) => {
        addMessage(msg.content, msg.role === "assistant" ? "assistant" : "user");
      });
    }
    sendResponse({ ok: true });
  }

  return true;
});

// ============ DYNAMIC PAGE SUPPORT (MutationObserver + URL tracking) ============

function initDynamicPageSupport() {
  // MutationObserver: detect significant DOM changes (SPA content updates)
  const observer = new MutationObserver((mutations) => {
    // Ignore mutations inside our widget
    const dominated = mutations.every((m) =>
      m.target.closest?.("#ai-web-reader-widget") ||
      m.target.closest?.("#ai-web-reader-fab") ||
      m.target.id === "ai-web-reader-widget" ||
      m.target.id === "ai-web-reader-fab"
    );
    if (dominated) return;

    // Only react to significant DOM changes (added/removed element nodes)
    let addedNodes = 0;
    for (const m of mutations) {
      if (m.type === "childList") {
        for (const n of m.addedNodes) if (n.nodeType === 1) addedNodes++;
        for (const n of m.removedNodes) if (n.nodeType === 1) addedNodes++;
      }
    }
    if (addedNodes < 5) return;

    // Debounce: wait for DOM to settle before checking
    clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(() => {
      checkForContentUpdate();
    }, 4000);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // URL polling: detect SPA navigation (pushState/replaceState)
  urlCheckInterval = setInterval(() => {
    if (window.location.href !== currentUrl) {
      handleUrlChange();
    }
  }, 1000);
}

async function handleUrlChange() {
  const newUrl = window.location.href;
  currentUrl = newUrl;
  lastContentHash = null;
  isAnalyzed = false;
  chatHistory = [];

  // Clear messages
  const messages = document.getElementById("ai-wr-messages");
  if (messages) messages.innerHTML = "";

  // Check if new URL was already analyzed
  chrome.runtime.sendMessage({ action: "getChatHistory", url: currentUrl }, (response) => {
    if (response?.history && response.history.length > 0) {
      chatHistory = response.history;
      isAnalyzed = true;
      showChat();
      setStatus("Ready", "ready");
      response.history.forEach((msg) => {
        addMessage(msg.content, msg.role === "assistant" ? "assistant" : "user");
      });
    } else {
      // Show analyze button for new page
      showAnalyze();
      setStatus("New page", "");
      addSystemMessage("Navigated to new page. Click analyze to index it.");
    }
  });
}

async function checkForContentUpdate() {
  if (!isAnalyzed || isReindexing) return;

  const content = extractPageContent();
  if (!content || content.length < 50) return;

  const newHash = await hashContent(content);
  if (newHash === lastContentHash) return;

  isReindexing = true;
  try {
    setStatus("Updating...", "analyzing");
    addSystemMessage("Page content changed \u2014 re-indexing...");
    await handleAnalyze(true);
  } finally {
    isReindexing = false;
  }
}

function showAnalyze() {
  const analyzeSection = document.getElementById("ai-wr-analyze");
  const chatSection = document.getElementById("ai-wr-chat");
  if (analyzeSection) analyzeSection.classList.remove("hidden");
  if (chatSection) chatSection.classList.add("hidden");

  const btn = document.getElementById("ai-wr-analyze-btn");
  if (btn) {
    btn.disabled = false;
    btn.textContent = "📄 Analyze This Page";
  }
}

// ============ INIT ============

function initWidget() {
  // Don't inject into extension pages or iframes
  if (window !== window.top) return;
  if (window.location.protocol === "chrome-extension:") return;

  // Inject styles
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = chrome.runtime.getURL("widget.css");
  document.head.appendChild(style);

  createFAB();
  createWidget();
  initWidgetEvents();
  initTextSelection();
  initDynamicPageSupport();

  // Restore chat history if page was already analyzed
  chrome.runtime.sendMessage({ action: "getChatHistory", url: currentUrl }, (response) => {
    if (response?.history && response.history.length > 0) {
      chatHistory = response.history;
      isAnalyzed = true;
      showChat();
      setStatus("Ready", "ready");
      response.history.forEach((msg) => {
        addMessage(msg.content, msg.role === "assistant" ? "assistant" : "user");
      });
    }
  });
}

// Wait for DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWidget);
} else {
  initWidget();
}
