import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Bespoke Site OS — Builder Console" }] }),
  component: BuilderConsole,
});

type Packet = {
  prompt: string;
  business: {
    name: string; category: string; city: string; state: string;
    current_website?: string; gbp_url?: string;
    source_platform: string;
  };
  build_type: string;
  toggles: Record<string, boolean>;
};

const STAGES = ["discover", "scrape", "rescue", "design", "build", "qc", "deploy"] as const;
type Stage = typeof STAGES[number];

function BuilderConsole() {
  const [packet, setPacket] = useState<Packet>({
    prompt: "",
    business: { name: "", category: "", city: "", state: "CA", source_platform: "none" },
    build_type: "landing",
    toggles: { firecrawl: true, gbp: true, local_serp: true, video_prompt: true, map: true, ai_chat: false, payment_cta: false },
  });
  const [status, setStatus] = useState<Record<Stage, "idle" | "running" | "done" | "fail">>(
    Object.fromEntries(STAGES.map((s) => [s, "idle"])) as any,
  );
  const [output, setOutput] = useState<{ url?: string; grade?: string; shots?: string[]; packet?: string; log: string[] } | null>(null);

  async function createSite() {
    setOutput({ log: [] });
    setStatus(Object.fromEntries(STAGES.map((s) => [s, "idle"])) as any);
    const res = await fetch("/api/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(packet) });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const ev of events) {
        const m = ev.match(/^event: (\S+)\ndata: (.+)$/m);
        if (!m) continue;
        const [type, dataRaw] = [m[1], m[2]];
        const data = JSON.parse(dataRaw);
        const [stage, phase] = type.split(".") as [Stage, string];
        if (STAGES.includes(stage)) {
          setStatus((s) => ({ ...s, [stage]: phase === "done" ? "done" : phase === "start" ? "running" : phase === "fail" ? "fail" : s[stage] }));
        }
        setOutput((o) => ({ ...(o ?? { log: [] }), log: [...(o?.log ?? []), `[${type}] ${JSON.stringify(data.payload)}`] }));
        if (type === "deploy.done") setOutput((o) => ({ ...(o ?? { log: [] }), url: data.payload.url }));
        if (type === "qc.done") setOutput((o) => ({ ...(o ?? { log: [] }), grade: data.payload.grade }));
        if (type === "build.done") setOutput((o) => ({ ...(o ?? { log: [] }), shots: data.payload.screenshots, packet: data.payload.packet_path }));
      }
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem", fontFamily: "ui-sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em" }}>Bespoke Site OS · Builder Console</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>Prompt in, A+ preview out. Zero per-site hand design.</p>

      <section style={grid()}>
        <textarea placeholder="Describe the business, tone, goals…" value={packet.prompt}
          onChange={(e) => setPacket({ ...packet, prompt: e.target.value })}
          style={{ ...input(), minHeight: 120, gridColumn: "1 / -1" }} />

        <input placeholder="Business name" style={input()} value={packet.business.name}
          onChange={(e) => setPacket({ ...packet, business: { ...packet.business, name: e.target.value } })} />
        <input placeholder="Category (e.g. landscaping, roofing)" style={input()} value={packet.business.category}
          onChange={(e) => setPacket({ ...packet, business: { ...packet.business, category: e.target.value } })} />
        <input placeholder="City" style={input()} value={packet.business.city}
          onChange={(e) => setPacket({ ...packet, business: { ...packet.business, city: e.target.value } })} />
        <input placeholder="State" maxLength={2} style={input()} value={packet.business.state}
          onChange={(e) => setPacket({ ...packet, business: { ...packet.business, state: e.target.value.toUpperCase() } })} />

        <input placeholder="Current website URL" style={input()} value={packet.business.current_website ?? ""}
          onChange={(e) => setPacket({ ...packet, business: { ...packet.business, current_website: e.target.value } })} />
        <input placeholder="Google Business Profile URL" style={input()} value={packet.business.gbp_url ?? ""}
          onChange={(e) => setPacket({ ...packet, business: { ...packet.business, gbp_url: e.target.value } })} />

        <select style={input()} value={packet.business.source_platform}
          onChange={(e) => setPacket({ ...packet, business: { ...packet.business, source_platform: e.target.value } })}>
          {["wordpress","wix","squarespace","godaddy","none","other"].map(o => <option key={o}>{o}</option>)}
        </select>
        <select style={input()} value={packet.build_type}
          onChange={(e) => setPacket({ ...packet, build_type: e.target.value })}>
          {["landing","multi-page","service-detail","full-site"].map(o => <option key={o}>{o}</option>)}
        </select>
      </section>

      <fieldset style={{ marginTop: 24, border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
        <legend>Enrichment & features</legend>
        {Object.keys(packet.toggles).map((k) => (
          <label key={k} style={{ marginRight: 16 }}>
            <input type="checkbox" checked={packet.toggles[k]}
              onChange={(e) => setPacket({ ...packet, toggles: { ...packet.toggles, [k]: e.target.checked } })} />
            {" " + k.replace(/_/g, " ")}
          </label>
        ))}
      </fieldset>

      <button onClick={createSite} style={{ marginTop: 24, padding: "16px 32px", fontWeight: 800, fontSize: 16, background: "#111", color: "#fff", border: 0, borderRadius: 8, cursor: "pointer" }}>
        Create Site →
      </button>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 14, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.6 }}>Build timeline</h2>
        <ol style={{ display: "flex", gap: 8, listStyle: "none", padding: 0 }}>
          {STAGES.map((s) => (
            <li key={s} style={{
              flex: 1, padding: "12px 8px", borderRadius: 6, textAlign: "center", fontSize: 12,
              background: status[s] === "done" ? "#0a7" : status[s] === "running" ? "#f80" : status[s] === "fail" ? "#d33" : "#eee",
              color: status[s] === "idle" ? "#666" : "#fff",
            }}>{s}</li>
          ))}
        </ol>
      </section>

      {output && (
        <section style={{ marginTop: 32, border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Output</h2>
          {output.url && <p>Preview: <a href={output.url} target="_blank" rel="noreferrer">{output.url}</a></p>}
          {output.grade && <p>Grade: <b>{output.grade}</b></p>}
          {output.shots && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
              {output.shots.map((src) => <img key={src} src={src} style={{ width: "100%" }} />)}
            </div>
          )}
          {output.packet && <p><a href={output.packet} download>Download packet.json</a></p>}
          <details><summary>Log</summary>
            <pre style={{ maxHeight: 300, overflow: "auto", fontSize: 11 }}>{output.log.join("\n")}</pre>
          </details>
        </section>
      )}
    </div>
  );
}

function grid(): React.CSSProperties { return { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 24 }; }
function input(): React.CSSProperties { return { padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc", fontSize: 14 }; }
