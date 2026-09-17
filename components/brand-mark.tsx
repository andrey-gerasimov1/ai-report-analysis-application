export function BrandMark({
  compact = false,
  fullWidth = false,
  onClick,
  disabled = false,
}: {
  compact?: boolean;
  fullWidth?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const content = (
    <span className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[11px] bg-gradient-to-br from-[#5d61b9] to-[#8b91d7] shadow-sm">
        <svg aria-hidden="true" viewBox="0 0 36 36" fill="none" className="size-6 text-white">
          <path d="M9 4.5h13l5 5V27a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M21.5 4.5v5h5M11 14h8M11 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="22" cy="22" r="4.5" fill="#5d61b9" stroke="currentColor" strokeWidth="2" />
          <path d="m25.4 25.4 3.4 3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-wordmark whitespace-nowrap text-[18px] font-semibold leading-none tracking-[-0.03em] text-[#5d61b9]">
          Report Analysis
        </span>
      )}
    </span>
  );

  if (!onClick) return <div aria-label="Report Analysis">{content}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Report Analysis — start a new chat"
      title="Start a new chat"
      className={`${fullWidth ? "min-w-0 flex-1 px-2 py-1" : "-m-1 p-1"} rounded-xl text-left transition hover:bg-[#f0effb] focus:outline-none focus:ring-2 focus:ring-[#8b91d7] disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {content}
    </button>
  );
}
