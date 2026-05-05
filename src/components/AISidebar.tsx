import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  Sparkles,
  Wand2,
  Lightbulb,
  AlertCircle,
  Loader2,
  LogIn,
  Mail,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/store/auth";
import { useUI } from "@/store/ui";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  pending?: boolean;
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
  const authStatus = useAuth((s) => s.status);
  const toggleAuth = useUI((s) => s.toggleAuth);
  const isAuthed = !!authStatus?.authenticated;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text:
        "Hi — I'm your terminal copilot. Sign in with your Cursor account to get started, then ask me about the current host, paste an error, or request a command.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agentIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const ensureAgent = async (): Promise<string> => {
    if (agentIdRef.current) return agentIdRef.current;
    const id = await ipc.aiCreateAgent(undefined, undefined);
    agentIdRef.current = id;
    return id;
  };

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    if (!isAuthed) {
      toggleAuth(true);
      return;
    }
    setError(null);
    setInput("");
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
    };
    const placeholder: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      pending: true,
    };
    setMessages((m) => [...m, userMsg, placeholder]);
    setBusy(true);
    try {
      const agentId = await ensureAgent();
      const res = await ipc.aiSend(agentId, trimmed);
      const text =
        typeof res.result === "string" && res.result.length > 0
          ? res.result
          : `(no text result — status: ${res.status})`;
      setMessages((m) =>
        m.map((msg) =>
          msg.id === placeholder.id ? { ...msg, text, pending: false } : msg
        )
      );
    } catch (e) {
      const msg = String(e);
      setError(msg);
      setMessages((m) =>
        m.map((x) =>
          x.id === placeholder.id
            ? { ...x, text: msg, pending: false, role: "system" }
            : x
        )
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="w-[360px] shrink-0 flex flex-col border-l border-border bg-bg/50 backdrop-blur">
      <header className="h-10 px-4 flex items-center gap-2 border-b border-border">
        <div className="h-6 w-6 rounded-md bg-accent/15 text-accent flex items-center justify-center">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-medium">Aether AI</span>
        {isAuthed ? (
          <button
            onClick={() => toggleAuth(true)}
            className="pill ml-auto hover:bg-bg-elevated cursor-pointer"
            title={authStatus?.user ?? "Manage Cursor account"}
          >
            <Mail className="h-2.5 w-2.5" />
            <span className="truncate max-w-[120px]">
              {authStatus?.user ?? "signed in"}
            </span>
          </button>
        ) : (
          <span className="pill ml-auto text-warn border-warn/30 bg-warn/10">
            signed out
          </span>
        )}
      </header>

      {!isAuthed && (
        <div className="p-4 border-b border-border bg-bg-subtle/50">
          <div className="text-[12px] text-fg-muted mb-2.5">
            Sign in with your Cursor account to use AI features. Your token is
            stored securely in the OS keyring.
          </div>
          <button
            onClick={() => toggleAuth(true)}
            className="auth-btn-primary"
          >
            <LogIn className="h-4 w-4" />
            <span className="flex-1 text-left">Sign in with Cursor</span>
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words",
              m.role === "user" &&
                "ml-8 bg-accent/15 border border-accent/20 text-fg",
              m.role === "assistant" &&
                "mr-4 bg-bg-elevated border border-border text-fg",
              m.role === "system" &&
                "mr-4 bg-danger/10 border border-danger/30 text-danger"
            )}
          >
            {m.pending ? (
              <span className="inline-flex items-center gap-2 text-fg-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                thinking…
              </span>
            ) : (
              m.text
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mx-3 mb-2 px-2.5 py-1.5 rounded-md bg-danger/10 border border-danger/30 text-[11px] text-danger flex items-start gap-1.5">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

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
            placeholder={
              isAuthed ? "Ask anything about this host…" : "Sign in to chat…"
            }
            rows={2}
            disabled={busy || !isAuthed}
            className="input resize-none pr-10 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={busy || !isAuthed}
            className="absolute right-2 bottom-2 h-7 w-7 inline-flex items-center
                       justify-center rounded-md bg-accent/20 text-accent
                       hover:bg-accent/30 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-fg-subtle">
          <span className="kbd mr-1">⌘I</span> toggle • Shift+Enter for newline
        </div>
      </div>
    </aside>
  );
}
