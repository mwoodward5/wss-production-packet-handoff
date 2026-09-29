import * as React from "react";
import { useTrust } from "@/trust-widgets/TrustProvider";

/**
 * ┌── MIRROR:TEMPLATE-CODE — AI CONCIERGE UI ───────────────────────────────
 * │ Floating bubble bottom-right. Talks to /api/chat, which is universal.
 * │ MIRRORING: nothing to change. Greeting + suggested questions are derived
 * │ from trustConfig, so a new client's copy appears automatically.
 * └──────────────────────────────────────────────────────────────────────────
 */
interface Msg {
  role: "user" | "assistant";
  content: string;
}

export function AskConcierge() {
  const cfg = useTrust();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const scroller = React.useRef<HTMLDivElement>(null);

  const name = cfg.business.name;
  const greeting = `Hi — I'm the ${name} assistant. Ask me about services, service areas, hours or what to do right now.`;

  const suggestions = React.useMemo(() => {
    const s: string[] = [];
    const first = cfg.location.serviceAreas?.[0];
    if (first) s.push(`Do you serve ${first}?`);
    s.push("My water heater is leaking — what now?");
    if (cfg.availability?.emergency?.available) s.push("Do you do emergency calls?");
    s.push("What are your hours?");
    return s.slice(0, 4);
  }, [cfg]);

  React.useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) {
        const why = await res.text().catch(() => "");
        setMsgs([
          ...next,
          {
            role: "assistant",
            content:
              (why || "I couldn't reach the assistant.") +
              (cfg.contact.phoneDisplay ? ` Please call ${cfg.contact.phoneDisplay}.` : ""),
          },
        ]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs([...next, { role: "assistant", content: acc }]);
      }
    } catch {
      setMsgs([
        ...next,
        {
          role: "assistant",
          content: cfg.contact.phoneDisplay
            ? `Connection hiccup — please call ${cfg.contact.phoneDisplay}.`
            : "Connection hiccup — please try again.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="concierge-fab"
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : `Ask ${name} anything`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="concierge-fab__pulse" aria-hidden="true" />
        {open ? "✕" : "Ask us anything"}
      </button>

      {open ? (
        <section className="concierge" role="dialog" aria-label={`${name} assistant`}>
          <header className="concierge__head">
            <span className="concierge__dot" aria-hidden="true" />
            <strong>{name} assistant</strong>
            <span className="concierge__ai">AI</span>
          </header>

          <div className="concierge__body" ref={scroller}>
            <div className="concierge__msg concierge__msg--bot">{greeting}</div>
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`concierge__msg concierge__msg--${m.role === "user" ? "me" : "bot"}`}
              >
                {m.content || (busy && i === msgs.length - 1 ? "…" : "")}
              </div>
            ))}
            {msgs.length === 0 ? (
              <div className="concierge__chips">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="concierge__chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <form
            className="concierge__form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe the problem…"
              aria-label="Your question"
              maxLength={1500}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
              →
            </button>
          </form>

          {cfg.contact.phoneDisplay ? (
            <a className="concierge__call" href={`tel:${cfg.contact.phone}`}>
              Or call {cfg.contact.phoneDisplay}
            </a>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
