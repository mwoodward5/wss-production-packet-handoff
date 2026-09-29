import { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  showCorners?: boolean;
}

export default function LightFrame({ children, className = "", showCorners = true }: Props) {
  return (
    <div className={`lightframe ${className}`}>
      {showCorners && (
        <>
          <span className="frame-corner tl" />
          <span className="frame-corner tr" />
          <span className="frame-corner bl" />
          <span className="frame-corner br" />
        </>
      )}
      <div className="relative overflow-hidden bg-paper-soft">{children}</div>
    </div>
  );
}
