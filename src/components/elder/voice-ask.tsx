"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ElderAnswer } from "@/server/elder-ask";
import { MicIcon, SpeakerIcon } from "./icons";
import { canListen, LISTEN_MESSAGES, listenOnce } from "./listen";
import { ElderPhoto } from "./photo";
import { speak, stopSpeaking } from "./speech";

type Phase = "idle" | "listening" | "thinking" | "answered" | "problem";

/**
 * Voice-first Ask for the elder: one big microphone, the words DayMate heard
 * in large text, then one answer card with photos, read aloud automatically.
 * Tap-to-ask suggestions are always available; typing is tucked away.
 */
export function VoiceAsk({
  elderId,
  suggestions,
  voiceEnabled,
  action,
}: {
  elderId: string;
  suggestions: string[];
  voiceEnabled: boolean;
  action: (question: unknown, elderId: unknown, spoken?: unknown) => Promise<ElderAnswer>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mic, setMic] = useState(false);
  const [interim, setInterim] = useState("");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState<Extract<ElderAnswer, { ok: true }> | null>(null);
  const [problem, setProblem] = useState("");
  const [lastWasSpoken, setLastWasSpoken] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [, startTransition] = useTransition();
  const stopRef = useRef<() => void>(() => {});
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMic(voiceEnabled && canListen());
    return () => {
      stopRef.current();
      stopSpeaking();
    };
  }, [voiceEnabled]);

  useEffect(() => {
    if (phase === "answered" || phase === "problem") statusRef.current?.focus();
  }, [phase]);

  function fail(message: string) {
    setProblem(message);
    setPhase("problem");
    speak(message);
  }

  function submit(question: string, spoken: boolean) {
    const q = question.trim();
    if (!q) return;
    stopSpeaking();
    setLastWasSpoken(spoken);
    setHeard(q);
    setAnswer(null);
    setPhase("thinking");
    startTransition(async () => {
      let res: ElderAnswer;
      try {
        res = await action(q, elderId, spoken);
      } catch {
        res = { ok: false, error: "I couldn't reach DayMate just now. Please check the internet and try again." };
      }
      if (res.heard) setHeard(res.heard);
      if (!res.ok) return fail(res.error);
      setAnswer(res);
      setPhase("answered");
      speak(res.text);
    });
  }

  function startListening() {
    stopSpeaking();
    setInterim("");
    setAnswer(null);
    setPhase("listening");
    stopRef.current = listenOnce({
      onInterim: setInterim,
      onFinal: (text) => submit(text, true),
      onError: (e) => fail(LISTEN_MESSAGES[e]),
    });
  }

  function reset() {
    stopRef.current();
    stopSpeaking();
    setPhase("idle");
    setAnswer(null);
    setHeard("");
    setInterim("");
    setProblem("");
  }

  const showSuggestions = phase === "idle" || phase === "answered" || phase === "problem";

  return (
    <div className="voice">
      {/* ── microphone ── */}
      {mic && (phase === "idle" || phase === "listening" || phase === "problem") && (
        <div className="voice-mic-wrap">
          <button
            type="button"
            className={`voice-mic${phase === "listening" ? " is-listening" : ""}`}
            onClick={phase === "listening" ? () => stopRef.current() : startListening}
            aria-label={phase === "listening" ? "Stop listening" : "Tap and speak your question"}
          >
            <MicIcon />
          </button>
          <p className="voice-mic-label" aria-live="polite">
            {phase === "listening" ? "Listening… speak now" : "Tap and speak"}
          </p>
          {phase === "listening" && interim && <p className="voice-interim">&ldquo;{interim}&rdquo;</p>}
        </div>
      )}

      {/* ── result ── */}
      <div ref={statusRef} tabIndex={-1} className="voice-result" aria-live="polite">
        {phase === "thinking" && (
          <>
            {heard && <p className="voice-heard">You asked: &ldquo;{heard}&rdquo;</p>}
            <p className="elder-card voice-thinking" role="status">
              Let me look<span aria-hidden="true">…</span>
            </p>
          </>
        )}
        {phase === "answered" && answer && (
          <>
            <p className="voice-heard">You asked: &ldquo;{heard}&rdquo;</p>
            <div className={`elder-card voice-answer${answer.noAnswer ? " is-unsure" : ""}`}>
              {answer.people.length > 0 && (
                <div className="voice-people">
                  {answer.people.map((p) => (
                    <figure key={p.name} className="voice-person">
                      <ElderPhoto name={p.name} url={p.photoUrl} size="lg" />
                      <figcaption>
                        {p.name}
                        <span>your {p.relationship}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <p className="voice-answer-text">{answer.text}</p>
            </div>
            <div className="voice-actions">
              <button type="button" className="elder-btn" onClick={() => speak(answer.text)}>
                <SpeakerIcon /> Say it again
              </button>
              {lastWasSpoken && mic && (
                <button type="button" className="elder-btn elder-btn-secondary" onClick={startListening}>
                  That&apos;s not what I said
                </button>
              )}
              <button type="button" className="elder-btn elder-btn-secondary" onClick={reset}>
                Ask something else
              </button>
            </div>
          </>
        )}
        {phase === "problem" && (
          <p role="alert" className="elder-card voice-problem">
            {problem}
          </p>
        )}
      </div>

      {/* ── tap to ask ── */}
      {showSuggestions && (
        <section aria-labelledby="suggest-h" className="voice-suggest">
          <h2 id="suggest-h" className="voice-suggest-title">
            {phase === "answered" ? "You could also ask" : mic ? "Or tap a question" : "Tap a question"}
          </h2>
          <ul>
            {suggestions.map((s) => (
              <li key={s}>
                <button type="button" className="elder-choice" onClick={() => submit(s, false)}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── typing (tucked away) ── */}
      {showSuggestions &&
        (typing ? (
          <form
            className="voice-type"
            onSubmit={(e) => {
              e.preventDefault();
              submit(typed, false);
              setTyped("");
            }}
          >
            <label htmlFor="voice-typed" className="elder-label">
              Type your question
            </label>
            <input id="voice-typed" className="elder-input" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={300} autoComplete="off" enterKeyHint="send" />
            <button type="submit" className="elder-btn" disabled={!typed.trim()}>
              Ask
            </button>
          </form>
        ) : (
          <button type="button" className="link-button voice-type-toggle" onClick={() => setTyping(true)}>
            Type instead
          </button>
        ))}
    </div>
  );
}
