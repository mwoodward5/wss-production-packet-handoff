import { useRef, useState } from "react";

interface MagneticButtonProps {
  children: React.ReactNode;
  href?: string;
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  dataCta?: string;
}

export default function MagneticButton({ children, href, className = "", onClick, type, disabled, dataCta }: MagneticButtonProps) {
  const ref = useRef<HTMLElement>(null);
  const [transform, setTransform] = useState("");

  const handleMouseMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setTransform(`translate(${x * 0.3}px, ${y * 0.3}px)`);
  };

  const handleMouseLeave = () => setTransform("");

  const props = {
    ref: ref as never,
    className: `inline-block transition-transform duration-300 ease-out ${className}`,
    style: { transform },
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    ...(dataCta ? { "data-cta": dataCta } : {}),
  };

  if (href) {
    return <a {...props} href={href}>{children}</a>;
  }
  return <button {...props} onClick={onClick} type={type} disabled={disabled}>{children}</button>;
}
