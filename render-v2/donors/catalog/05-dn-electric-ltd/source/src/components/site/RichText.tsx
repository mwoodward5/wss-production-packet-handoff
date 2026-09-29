export function RichText({ text }: { text: string }) {
  return <div className="space-y-5">{text.split(/\r?\n\s*\r?\n/).filter(Boolean).map((block, i) => {
    const lines = block.split(/\r?\n/);
    if (/^#{1,6}\s/.test(block)) return <h2 key={i} className="display pt-3 text-2xl">{block.replace(/^#{1,6}\s+/, '')}</h2>;
    if (lines.every(line => /^\s*[-*]\s+/.test(line))) return <ul key={i} className="list-disc pl-5 space-y-2">{lines.map((line, j) => <li key={j}>{line.replace(/^\s*[-*]\s+/, '')}</li>)}</ul>;
    return <p key={i} className="leading-relaxed whitespace-pre-line">{block}</p>;
  })}</div>;
}
