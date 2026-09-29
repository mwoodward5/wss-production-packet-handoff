interface Props {
  label?: string;
  meta?: string[];
  side?: "left" | "right";
}
export default function SideRail({ label = "REEL 01", meta = [], side = "left" }: Props) {
  return (
    <div className={`hidden lg:flex absolute top-0 bottom-0 ${side === "left" ? "left-6" : "right-6"} z-20 flex-col items-center justify-between py-32 pointer-events-none`}>
      <div className="label-eyebrow text-ivory/60" style={{ writingMode: "vertical-rl", transform: side === "left" ? "rotate(180deg)" : undefined }}>
        {label}
      </div>
      <div className="w-px h-32 bg-gradient-to-b from-transparent via-molten/60 to-transparent" />
      <div className="flex flex-col gap-3 items-center">
        {meta.map((m) => (
          <span key={m} className="font-mono text-[0.6rem] text-ivory/50 tracking-widest" style={{ writingMode: "vertical-rl" }}>{m}</span>
        ))}
      </div>
    </div>
  );
}
