// Compiler copy is text, never executable HTML.
export const CertifiedCopy=({blocks}:{blocks:string[]})=><>{blocks.map((block,i)=>{
 const heading=block.match(/^#{1,6}\s+([^\n]+)(?:\n([\s\S]*))?$/);
 return <div key={i}>{heading?<><h3 className="font-display text-xl font-bold text-foreground">{heading[1]}</h3>{heading[2]&&<p className="mt-3 whitespace-pre-line">{heading[2]}</p>}</>:<p className="mt-3 whitespace-pre-line">{block}</p>}</div>;
})}</>;
