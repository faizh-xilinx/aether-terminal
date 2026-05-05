import { useState } from "react";
import { Bot, Send, Sparkles, Wand2, Lightbulb } from "lucide-react";

import { cn } from "@/lib/cn";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

const SUGGESTIONS = [
  {
    icon: <Wand2 className="h-3.5 w-3.5" />,
    text: "Translate \"deploy staging and tail logs\" to a command",
  },
  {
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    text: "Explain the last error",
  },
  {
    icon: <Sparkles className="h-3.5 w-3.5" />,
    text: "Summarize what I did on this host today",
  },
];

export function AISidebar() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text:
        "Hi — I’m your terminal copilot. Ask me about the current host, paste an error, or request a command. I’ll see your scrollback when you opt in.",
    },
  ]);
  const [input, setInput] = useState("");

  const send = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text: trimmed },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text:
          "(SDK sidecar not yet connected — once wired, this is where streaming Cursor responses appear.)",
      },
    ]);
    setInput("");
  };

  return (
    <aside className="w-[360px] shrink-0 flex flex-col border-l border-border bg-bg/50 backdrop-blur">
      <header className="h-10 px-4 flex items-center gap-2 border-b border-border">
        <div className="h-6 w-6 rounded-md bg-accent/15 text-accent flex items-center justify-center">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-medium">Aether AI</span>
        <span className="pill ml-auto">composer-2</span>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "rounded-lg px-3 py-2 text-[13px] leading-relaxed",
              m.role === "user"
                ? "ml-8 bg-accent/15 border border-accent/20 text-fg"
                : "mr-4 bg-bg-elevated border border-border text-fg-muted"
            )}
          >
            {m.text}
          </div>
        ))}
      </div>

      <div className="px-3 pb-2 grid grid-cols-1 gap-1.5">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            onClick={() => setInput(s.text)}
            className="text-left text-[12px] px-2.5 py-1.5 rounded-md flex items-center gap-2
                       text-fg-muted hover:text-fg bg-bg-subtle hover:bg-bg-elevated
                       border border-border"
          >
            <span className="text-accent">{s.icon}</span>
            <span className="truncate">{s.text}</span>
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-border">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask anything about this host…"
            rows={2}
            className="input resize-none pr-10"
          />
          <button
            onClick={send}
            className="absolute right-2 bottom-2 h-7 w-7 inline-flex items-center
                       justify-center rounded-md bg-accent/20 text-accent
                       hover:bg-accent/30"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-fg-subtle">
          <span className="kbd mr-1">⌘I</span> toggle • Shift+Enter for newline
        </div>
      </div>
    </aside>
  );
}
