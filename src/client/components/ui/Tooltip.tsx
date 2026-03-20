interface TooltipProps {
  text: string;
  children?: React.ReactNode;
}

export function Tooltip({ text }: TooltipProps) {
  if (!text) return null;
  return (
    <span className="relative group inline-flex items-center cursor-help ml-1">
      <span className="text-muted text-xs select-none">&#9432;</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-50 text-left leading-relaxed whitespace-normal shadow-lg">
        {text}
      </span>
    </span>
  );
}
