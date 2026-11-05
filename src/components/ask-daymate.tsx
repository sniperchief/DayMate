"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { askAction } from "@/app/(app)/ask/actions";
import type { Source } from "@/server/ask";

interface Message {
  id: number;
  role: "question" | "answer" | "error";
  text: string;
  sources?: Source[];
  noAnswer?: boolean;
}

const SOURCE_LABELS: Record<Source, string> = {
  profile: "your profile",
  family: "your family list",
  routines: "your routines",
  memories: "your saved memories",
};

/**
 * Question-and-answer view. The conversation lives only in this component's
 * state (this browser tab); every question is answered fresh on the server.
 */
export function AskDayMate({ elderId, examples }: { elderId: string; examples: string[] }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  function send(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setMessages((m) => [...m, { id: nextId.current++, role: "question", text: q }]);
    setQuestion("");
    startTransition(async () => {
      let reply: Message;
      try {
        const res = await askAction(q, elderId);
        reply = res.ok
          ? { id: nextId.current++, role: "answer", text: res.answer.text, sources: res.answer.sources, noAnswer: res.answer.noAnswer }
          : { id: nextId.current++, role: "error", text: res.error };
      } catch {
        reply = { id: nextId.current++, role: "error", text: "I couldn't reach DayMate just now. Please check your connection and try again." };
      }
      setMessages((m) => [...m, reply]);
      inputRef.current?.focus();
    });
  }

  return (
    <div className="ask">
      <div className="ask-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation with DayMate">
        {messages.length === 0 && (
          <div className="ask-welcome">
            <p className="ask-welcome-title">Hello! What would you like to know?</p>
            <p className="muted">Try one of these, or type your own question below.</p>
            <ul className="ask-examples" aria-label="Example questions">
              {examples.map((ex) => (
                <li key={ex}>
                  <button type="button" className="btn btn-secondary ask-example" onClick={() => send(ex)} disabled={pending}>
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.role}${m.noAnswer ? " bubble-unsure" : ""}`}>
            <span className="visually-hidden">{m.role === "question" ? "You asked:" : m.role === "error" ? "Problem:" : "DayMate:"}</span>
            <p className="bubble-text">{m.text}</p>
            {!m.noAnswer && m.sources && m.sources.length > 0 && <p className="bubble-source">From {m.sources.map((s) => SOURCE_LABELS[s]).join(" and ")}</p>}
          </div>
        ))}
        {pending && (
          <div className="bubble bubble-answer bubble-loading" role="status">
            DayMate is looking<span aria-hidden="true">…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
      >
        <label htmlFor={inputId} className="visually-hidden">
          Your question
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question…"
          maxLength={300}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" className="btn" disabled={pending || !question.trim()}>
          {pending ? "Looking…" : "Send"}
        </button>
      </form>
      {messages.length > 0 && (
        <div className="ask-more">
          <span className="muted">More ideas:</span>
          {examples.slice(0, 3).map((ex) => (
            <button key={ex} type="button" className="link-button" onClick={() => send(ex)} disabled={pending}>
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
