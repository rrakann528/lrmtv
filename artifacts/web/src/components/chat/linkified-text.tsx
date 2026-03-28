import { linkifyText } from '@/lib/linkify';

interface Props {
  text: string;
  className?: string;
}

export function LinkifiedText({ text, className }: Props) {
  const parts = linkifyText(text);
  const base = `whitespace-pre-wrap break-all leading-relaxed ${className ?? ''}`.trim();

  if (parts.length === 1 && parts[0].type === 'text') {
    return <p className={base}>{text}</p>;
  }

  return (
    <p className={base}>
      {parts.map((part, i) =>
        part.type === 'link' ? (
          <a
            key={i}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 break-all"
            onClick={e => e.stopPropagation()}
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </p>
  );
}
