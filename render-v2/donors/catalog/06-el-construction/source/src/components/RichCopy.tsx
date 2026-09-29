// Certified Markdown remains text; never execute supplied HTML.
export function RichCopy({text}:{text:string}) {
 if (!text) return null;
 return <div className="prose-content space-y-5 text-lg leading-relaxed text-muted-foreground">{text.split(/\n\s*\n/).map((p,i)=>p.startsWith('# ') || p.startsWith('## ') ? <h2 key={i} className="font-display text-3xl font-semibold text-foreground">{p.replace(/^#+\s*/, '')}</h2> : <p className="whitespace-pre-line" key={i}>{p}</p>)}</div>;
}
