import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageCircle, X, Send, Sparkles } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";

export function BookingAgent({ onBook }: { onBook: () => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/public/chat" }),
  });
  const isLoading = status === "submitted" || status === "streaming";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input.trim() });
    setInput("");
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-signal text-ink font-semibold rounded-full shadow-2xl px-5 py-3.5 flex items-center gap-2 emboss hover:brightness-110 transition"
          aria-label="Open booking assistant"
        >
          <Sparkles size={16} />
          <span className="hidden sm:inline">Ask about booking</span>
          <span className="sm:hidden">Ask AI</span>
        </button>
      )}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[min(400px,calc(100vw-2rem))] h-[600px] max-h-[calc(100vh-3rem)] glass flex flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-signal/20 text-signal grid place-items-center">
                <Sparkles size={14} />
              </div>
              <div>
                <div className="text-sm font-semibold">{siteConfig.studioName} Assistant</div>
                <div className="text-[10px] text-fadetext">
                  Powered by Lovable AI
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-fadetext hover:text-bone"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="glass p-3 text-fadetext">
                  Hi! I can answer questions about {siteConfig.artistName}'s process, pricing,
                  aftercare, and help you think through your idea before you submit a request.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "How much does a small tattoo cost?",
                    "Do you do walk-ins?",
                    "How do I book?",
                    "What styles does the artist do?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage({ text: q })}
                      className="tag hover:text-bone hover:border-signal/50 transition"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => {
              const text = m.parts
                .map((p) => (p.type === "text" ? p.text : ""))
                .join("");
              return (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-signal text-ink"
                        : "bg-surface border border-line text-bone"
                    }`}
                  >
                    {text}
                  </div>
                </div>
              );
            })}
            {isLoading && (
              <div className="text-fadetext text-xs italic">Thinking…</div>
            )}
          </div>

          <div className="border-t border-line p-3 space-y-2">
            <button
              onClick={() => {
                setOpen(false);
                onBook();
              }}
              className="w-full text-xs text-signal hover:brightness-110 border border-signal/40 rounded-full py-1.5"
            >
              Ready? Go to booking form →
            </button>
            <form onSubmit={submit} className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything…"
                className="field text-sm"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="bg-signal text-ink px-3 rounded-lg emboss disabled:opacity-50"
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
