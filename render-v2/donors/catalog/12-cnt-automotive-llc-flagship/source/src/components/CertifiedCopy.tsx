// Render certified markdown as text elements, never executable HTML or remote embeds.
// This small supported subset preserves paragraphs, headings and lists without new packages.
export default function CertifiedCopy({ text }: { text: string }) {
  return <div className="space-y-4">{text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/).filter(Boolean).map((block, i) => {
    if (/^#{1,6} /.test(block)) return <h3 key={i} className="font-bold text-xl">{block.replace(/^#{1,6} /, '')}</h3>;
    const lines = block.split('\n');
    if (lines.every(line => /^[-*] /.test(line))) return <ul key={i} className="list-disc pl-5 space-y-2">{lines.map((line,j) => <li key={j}>{line.slice(2)}</li>)}</ul>;
    return <p key={i} className="whitespace-pre-line">{block}</p>;
  })}</div>;
}
