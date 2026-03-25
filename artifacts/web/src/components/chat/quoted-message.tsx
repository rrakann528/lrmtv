interface Props {
  senderName: string;
  text: string;
}

export function QuotedMessage({ senderName, text }: Props) {
  return (
    <div className="flex items-start gap-1.5 mb-1 pl-1">
      <div className="w-0.5 min-h-[24px] bg-primary/50 rounded-full flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-primary/70 truncate">{senderName}</p>
        <p className="text-[11px] text-white/40 truncate max-w-[200px]">{text}</p>
      </div>
    </div>
  );
}
