import { Link } from '@tanstack/react-router';
import { BUSINESS } from '@/lib/business';
export function Logo({ className = '', onDark = false }: { className?: string; onDark?: boolean }) {
  return <Link to="/" className={`flex min-w-0 items-center gap-3 ${className}`} aria-label={`${BUSINESS.name} home`}>
    <img src={onDark ? BUSINESS.logoOnDark : BUSINESS.logo} alt={`${BUSINESS.name} logo`} className="h-11 w-11 shrink-0 object-contain" width={44} height={44} />
    <div className="min-w-0 leading-tight">
      <div className="display break-words text-base text-foreground">{BUSINESS.name}</div>
      <div className="eyebrow text-[0.58rem]">{BUSINESS.city}, {BUSINESS.state}</div>
    </div>
  </Link>;
}
