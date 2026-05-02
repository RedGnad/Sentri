/**
 * Shared editorial page header — section number, title, italic subtitle.
 * Used across /vaults, /v/[address]/*, /my, /deploy.
 */
export function PageHeader({
  num,
  section,
  title,
  subtitle,
  right,
}: {
  num: string;
  section: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="border-b border-hairline pb-6 flex items-end justify-between gap-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mb-3">
          § {num} · {section}
        </div>
        <h1 className="font-serif text-5xl sm:text-6xl text-ink tracking-tightest leading-none">
          {title}
        </h1>
        {subtitle && (
          <p className="font-serif italic text-lg text-ink-dim mt-3">{subtitle}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}
