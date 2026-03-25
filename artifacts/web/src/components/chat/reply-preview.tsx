import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface Props {
  senderName: string;
  text: string;
  onCancel: () => void;
}

export function ReplyPreview({ senderName, text, onCancel }: Props) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10 bg-white/5">
      <div className="w-0.5 h-8 bg-primary rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-primary truncate">{senderName}</p>
        <p className="text-xs text-white/50 truncate">{text}</p>
      </div>
      <button onClick={onCancel} className="p-1 text-white/30 hover:text-white/60">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
