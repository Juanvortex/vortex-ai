
import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import "highlight.js/styles/github-dark.css";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function App() {
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [conversationId, setConversationId] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [listening, setListening] = useState(false);
const [speaking, setSpeaking] = useState(false);
const [voiceSupported, setVoiceSupported] = useState(false);

const recognitionRef = useRef(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  setVoiceSupported(Boolean(SpeechRecognition));
}, []);

  // Check backend connection.
  async function regenerateResponse() {
  if (!conversationId || loading) return;

  setLoading(true);

  try {
    const response = await fetch(
      `${API_URL}/api/conversations/${conversationId}/regenerate`,
      {
        method: "POST",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Could not regenerate response.");
    }

    setMessages((previous) => {
      const updated = [...previous];

      const lastAssistantIndex = updated.findLastIndex(
        (message) => message.role === "assistant"
      );

      if (lastAssistantIndex !== -1) {
        updated[lastAssistantIndex] = {
          ...updated[lastAssistantIndex],
          content: data.reply,
          isError: false,
        };
      }

      return updated;
    });

    setConnected(true);
  } catch (error) {
    alert(error.message);
  } finally {
    setLoading(false);
  }
}
  async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  } catch (error) {
    console.error("Copy failed:", error);
    alert("Could not copy text.");
  }
}
  async function checkBackend() {
    try {
      const response = await fetch(`${API_URL}/api/health`);
      setConnected(response.ok);
    } catch {
      setConnected(false);
    }
  }

  // Load saved conversations.
  async function loadConversations() {
    try {
      const response = await fetch(`${API_URL}/api/conversations`);

      if (!response.ok) {
        throw new Error("Could not load conversations");
      }

      const data = await response.json();
      setConversations(data);
    } catch (error) {
      console.error("Conversation loading error:", error);
    }
  }

  useEffect(() => {
    checkBackend();
    loadConversations();
  }, []);

  // Scroll to the newest message.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, loading]);

  // Start a fresh conversation.
  function newChat() {
    if (loading) return;

    setConversationId(null);
    setMessages([]);
    setPrompt("");
    inputRef.current?.focus();
  }

  // Open a saved conversation.
  async function openConversation(id) {
    if (loading || historyLoading) return;

    setHistoryLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${id}/messages`
      );

      if (!response.ok) {
        throw new Error("Could not open this conversation");
      }

      const data = await response.json();

      setConversationId(id);
      setMessages(
        data.map((item) => ({
          role: item.role,
          content: item.content,
        }))
      );

      setPrompt("");

    } catch (error) {
      alert(error.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  // Delete a saved conversation.
  async function deleteConversation(id) {
    if (loading || historyLoading) return;

    const confirmed = window.confirm(
      "Are you sure you want to delete this conversation?"
    );

    if (!confirmed) return;

    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${id}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Could not delete conversation");
      }

      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }

      await loadConversations();

    } catch (error) {
      alert(error.message);
    }
  }
  async function renameConversation(id, currentTitle) {
  const newTitle = window.prompt(
    "Enter a new conversation title:",
    currentTitle
  );

  if (newTitle === null) return;

  const title = newTitle.trim();

  if (!title) {
    alert("Conversation title cannot be empty.");
    return;
  }

  if (title.length > 80) {
    alert("Title cannot exceed 80 characters.");
    return;
  }

  try {
    const response = await fetch(
      `${API_URL}/api/conversations/${id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Could not rename conversation.");
    }

    await loadConversations();
  } catch (error) {
    alert(error.message);
  }
}

  // Send a message to Gemini and save it in SQLite.
  async function sendMessage(e) {
    e.preventDefault();

    const question = prompt.trim();

    if (!question || loading) return;

    setMessages((previous) => [
      ...previous,
      { role: "user", content: question },
    ]);

    setPrompt("");
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: question,
          conversation_id: conversationId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Something went wrong. Please try again."
        );
      }

      // Store the ID returned by the backend.
      setConversationId(data.conversation_id);

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: data.reply,
        },
      ]);

      setConnected(true);

      // Refresh the saved conversation list.
      await loadConversations();

    } catch (error) {
      setConnected(false);

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: `I encountered a problem: ${error.message}`,
          isError: true,
        },
      ]);

    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  // Enter sends; Shift + Enter creates a new line.
  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e);
    }
  }
  const filteredConversations = conversations.filter((conversation) =>
  conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
);

const startVoiceInput = () => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert("Voice input is not supported in this browser.");
    return;
  }

  const recognition = new SpeechRecognition();

  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    setListening(true);
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;

    setMessage((prev) =>
      prev ? `${prev} ${transcript}` : transcript
    );
  };

  recognition.onerror = (event) => {
    console.error("Voice recognition error:", event.error);
  };

  recognition.onend = () => {
    setListening(false);
  };

  recognition.start();
};
  return (
    <div className="app-shell">

      {/* SIDEBAR */}
      <aside className="sidebar">

        <div className="brand">
          <div className="brand-icon">V</div>

          <div>
            <h2>VORTEX<span>AI</span></h2>
            <small>INTELLIGENCE PLATFORM</small>
          </div>
        </div>

        <button
          className="new-chat"
          onClick={newChat}
          disabled={loading || historyLoading}
        >
          <span>＋</span> New conversation
        </button>

        <div className="nav-label">WORKSPACE</div>

        <nav className="navigation">
          <button className="nav-item active">
            ◈ <span>AI Assistant</span>
          </button>

          <button className="nav-item" disabled>
            ⌘ <span>Code Assistant</span>
          </button>

          <button className="nav-item" disabled>
            ▤ <span>Documents</span>
          </button>
        </nav>

        {/* SAVED CONVERSATIONS */}
        <div className="history-section">

          <div className="history-heading">
            <span>RECENT CHATS</span>
            <span>{conversations.length}</span>
          </div>

          <input
  className="conversation-search"
  type="text"
  placeholder="Search conversations..."
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
/>

          <div className="conversation-list">

            {historyLoading && (
              <p className="history-empty">Loading chat...</p>
            )}

            {!historyLoading && filteredConversations.length === 0 && (
  <p className="history-empty">
    {searchQuery
      ? "No matching conversations found."
      : "Your conversations will appear here."}
  </p>
)}

            {filteredConversations.map((conversation) => (

              <div
                className={`conversation-item ${
                  conversationId === conversation.id ? "selected" : ""
                }`}
                key={conversation.id}
              >

                <button
                  className="conversation-open"
                  onClick={() => openConversation(conversation.id)}
                  disabled={loading || historyLoading}
                  title={conversation.title}
                >
                  <span className="conversation-icon">◷</span>

                  <span className="conversation-title">
                    {conversation.title}
                  </span>
                </button>

                <button
                  className="conversation-delete"
                  onClick={() => deleteConversation(conversation.id)}
                  disabled={loading || historyLoading}
                  title="Delete conversation"
                  aria-label={`Delete ${conversation.title}`}
                >
                  ×
                </button>

                <button
  className="conversation-rename"
  onClick={() =>
    renameConversation(conversation.id, conversation.title)
  }
  disabled={loading || historyLoading}
  title="Rename conversation"
  aria-label={`Rename ${conversation.title}`}
>
  ✎
</button>

              </div>

            ))}

          </div>

        </div>

        <div className="sidebar-bottom">

          <div className="profile">
            <div className="avatar">JV</div>

            <div>
              <strong>JUANVORTEX</strong>
              <small>Personal workspace</small>
            </div>

            <span className="profile-dot"></span>
          </div>

        </div>

      </aside>

      {/* MAIN AREA */}
      <main className="main-area">

        <header className="topbar">

          <div>
            <span className="mobile-brand">VORTEX AI</span>

            <span className="workspace-label">
              PERSONAL WORKSPACE / ASSISTANT
            </span>
          </div>

          <div className="system-status">

            <span
              className={`status-dot ${
                connected === false ? "offline" : ""
              } ${connected === null ? "checking" : ""}`}
            ></span>

            {connected === null
              ? "CONNECTING..."
              : connected
              ? "SYSTEM ONLINE"
              : "BACKEND OFFLINE"}

          </div>

        </header>

        {/* CHAT AREA */}
        <section className="chat-area">

          {messages.length === 0 ? (

            <div className="welcome">

              <div className="orb">
                <div className="orb-inner">V</div>
              </div>

              <div className="eyebrow">
                YOUR INTELLIGENCE COMPANION
              </div>

              <h1>
                Think beyond<br />
                <span>limits.</span>
              </h1>

              <p>
                Welcome to VORTEX AI. Ask questions, explore ideas,
                learn new skills and build something extraordinary.
              </p>

              <div className="suggestions">

                <button
                  onClick={() =>
                    setPrompt("Teach me artificial intelligence")
                  }
                >
                  <span>✦</span>
                  <strong>Learn something</strong>
                  <small>Explore AI and technology</small>
                </button>

                <button
                  onClick={() =>
                    setPrompt("Help me write a Python program")
                  }
                >
                  <span>⌘</span>
                  <strong>Write some code</strong>
                  <small>Build and debug projects</small>
                </button>

                <button
                  onClick={() =>
                    setPrompt("Give me ideas for a useful AI project")
                  }
                >
                  <span>◇</span>
                  <strong>Explore ideas</strong>
                  <small>Turn ideas into projects</small>
                </button>

              </div>

            </div>

          ) : (

            <div className="messages" aria-live="polite">

              {messages.map((message, index) => (

                <div
                  className={`message ${message.role}`}
                  key={index}
                >

                  <div className="message-avatar">
                    {message.role === "assistant" ? "V" : "JV"}
                  </div>

                  <div className="message-content">

                    <strong>
                      {message.role === "assistant"
                        ? "VORTEX AI"
                        : "YOU"}
                    </strong>

                    {message.role === "assistant" && !message.isError ? (
  <div className="markdown-wrapper">
  <div className="markdown-content">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children, ...props }) {
          return (
            <div className="code-block-wrapper">
              <button
                className="copy-code-button"
                onClick={() => {
                  const code = children?.props?.children ?? "";
                  copyToClipboard(String(code));
                }}
              >
                Copy code
              </button>

              <pre {...props}>{children}</pre>
            </div>
          );
        },
      }}
    >
      {message.content}
    </ReactMarkdown>
  </div>

  <button
    className="copy-response-button"
    onClick={() => copyToClipboard(message.content)}
  >
    <span>⧉</span> Copy response
  </button>
  {index === messages.length - 1 && conversationId && (
  <button
    className="regenerate-button"
    onClick={regenerateResponse}
    disabled={loading}
  >
    ↻ Regenerate
  </button>
)}
</div>
) : (
  <p className={message.isError ? "error-message" : ""}>
    {message.content}
  </p>
)}

                  </div>

                </div>

              ))}

              {loading && (

                <div className="message assistant">

                  <div className="message-avatar">V</div>

                  <div className="message-content">
                    <strong>VORTEX AI</strong>

                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                      <small>Thinking...</small>
                    </div>
                  </div>

                </div>

              )}

              <div ref={messagesEndRef}></div>

            </div>

          )}

        </section>

        {/* INPUT */}
        <footer className="input-area">

          <form className="chat-form" onSubmit={sendMessage}>

            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message VORTEX AI..."
              aria-label="Message VORTEX AI"
              rows={1}
              disabled={loading}
            />

                        <button
              type="button"
              onClick={startVoiceInput}
              disabled={!voiceSupported || loading}
              aria-label="Voice input"
              title={listening ? "Listening..." : "Start voice input"}
              className={listening ? "listening" : ""}
            >
              {listening ? "🔴" : "🎤"}
            </button>

            <button
              type="submit"
              disabled={!prompt.trim() || loading}
              aria-label="Send message"
            >
              ↑
            </button>

          </form>

          <p>
            VORTEX AI can make mistakes. Verify important information.
          </p>

        </footer>

      </main>

    </div>
  );
}

export default App;
