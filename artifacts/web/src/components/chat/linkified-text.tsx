import React from 'react';
import { linkifyText } from '@/lib/linkify';

interface Props {
  text: string;
  className?: string;
}

function renderWithMentions(value: string): (string | React.ReactElement)[] {
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const result: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(value)) !== null) {
    if (match.index > lastIndex) {
      result.push(value.slice(lastIndex, match.index));
    }
    result.push(
      <span key={`m-${match.index}`} className="text-cyan-400 font-semibold">
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    result.push(value.slice(lastIndex));
  }
  return result;
}

export function LinkifiedText({ text, className }: Props) {
  const parts = linkifyText(text);
  const base = `whitespace-pre-wrap break-all leading-relaxed ${className ?? ''}`.trim();

  if (parts.length === 1 && parts[0].type === 'text') {
    const rendered = renderWithMentions(text);
    if (rendered.length === 1 && typeof rendered[0] === 'string') {
      return <p className={base}>{text}</p>;
    }
    return <p className={base}>{rendered}</p>;
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
          <span key={i}>{renderWithMentions(part.value)}</span>
        )
      )}
    </p>
  );
}
