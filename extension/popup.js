const API_BASE = "https://api.aiwebreader.geekytwin.com";

// DOM elements
const analyzeBtn = document.getElementById("analyze-btn");
const analyzeSection = document.getElementById("analyze-section");
const chatSection = document.getElementById("chat-section");
const messagesDiv = document.getElementById("messages");
const questionInput = document.getElementById("question-input");
const sendBtn = document.getElementById("send-btn");
const statusEl = document.getElementById("status");

// State
let currentUrl = "";
let chatHistory = [];

// Quick action prompts
const quickActions = {
  summarize: "Please provide a concise summary of this page.",
  keypoints: "What are the key points and main takeaways from this page?",
  eli5: "Explain the content of this page like I'm 5 years old.",
};

// Initialize
document.addEventListener("DOMContentLoaded", init);

async function init() {
  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = tab.url;

  // Check if already analyzed
  chrome.runtime.sendMessage(
    { action: "getAnalysisStatus", url: currentUrl },
    (response) => {
      if (response?.analyzed) {
        showChat();
        addSystemMessage("Page already analyzed. Ask away!");
      }
    }
  );
}

// Analyze button
analyzeBtn.addEventListener("click", async () => {
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "⏳ Analyzing...";
  setStatus("Extracting content...", "analyzing");

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Extract content from page
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "extractContent",
    });

    if (!response?.content) {
      throw new Error("Could not extract page content");
    }

    setStatus("Generating embeddings...", "analyzing");

    // Send to backend for analysis
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "analyzeContent",
          url: response.url,
          content: response.content,
        },
        (res) => {
          if (res?.error) reject(new Error(res.error));
          else resolve(res);
        }
      );
    });

    showChat();
    const chunkInfo = result.chunks ? ` (${result.chunks} chunks indexed)` : "";
    addSystemMessage(`Page analyzed successfully${chunkInfo}. Ask me anything!`);
    setStatus("Ready to chat", "ready-chat");
  } catch (err) {
    setStatus("Error: " + err.message, "error");
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "📄 Analyze This Page";
  }
});

// Send message
sendBtn.addEventListener("click", sendMessage);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Quick action buttons
document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    questionInput.value = quickActions[action];
    sendMessage();
  });
});

async function sendMessage() {
  const question = questionInput.value.trim();
  if (!question) return;

  // Add user message
  addMessage(question, "user");
  questionInput.value = "";
  sendBtn.disabled = true;

  // Show typing indicator
  const typingEl = addTypingIndicator();

  try {
    // Stream response from backend
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

    // Remove typing indicator
    typingEl.remove();

    // Create assistant message element for streaming
    const msgEl = addMessage("", "assistant");
    let fullResponse = "";

    // Read SSE stream
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
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    // Update chat history
    chatHistory.push({ role: "user", content: question });
    chatHistory.push({ role: "assistant", content: fullResponse });
  } catch (err) {
    typingEl.remove();
    addMessage("Error: " + err.message, "system");
  } finally {
    sendBtn.disabled = false;
    questionInput.focus();
  }
}

// UI Helpers
function showChat() {
  analyzeSection.classList.add("hidden");
  chatSection.classList.remove("hidden");
}

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = "status" + (className ? " " + className : "");
}

function addMessage(content, role) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = content;
  messagesDiv.appendChild(el);
  scrollToBottom();
  return el;
}

function addSystemMessage(text) {
  addMessage(text, "system");
}

function addTypingIndicator() {
  const el = document.createElement("div");
  el.className = "message assistant typing-indicator";
  el.innerHTML = "<span></span><span></span><span></span>";
  messagesDiv.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Add hidden class styles for analyze section
const style = document.createElement("style");
style.textContent = ".analyze-section.hidden { display: none; }";
document.head.appendChild(style);
