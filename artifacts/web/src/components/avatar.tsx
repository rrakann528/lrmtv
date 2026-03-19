import { useState, useEffect } from 'react';
import { findAvatar, isPresetAvatar, getPresetId } from '@/lib/avatars';

interface AvatarProps {
  name: string;
  color: string;
  url?: string | null;
  size?: number;
  className?: string;
}

export function Avatar({ name, color, url, size = 40, className = '' }: AvatarProps) {
  const initials = name.slice(0, 2).toUpperCase();
  const style = { width: size, height: size, minWidth: size, minHeight: size };
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [url]);

  if (isPresetAvatar(url)) {
    const avatar = findAvatar(getPresetId(url!));
    if (avatar) {
      return (
        <img
          src={avatar.url}
          alt={name}
          style={style}
          className={`rounded-full object-cover flex-shrink-0 bg-white ${className}`}
        />
      );
    }
  }

  if (url && !imgError) {
    return (
      <img
        src={url}
        alt={name}
        style={style}
        onError={() => setImgError(true)}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      style={{ ...style, backgroundColor: color + '33', border: `2px solid ${color}55`, fontSize: size * 0.4 }}
      className={`rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 ${className}`}
    >
      <span style={{ color }}>{initials}</span>
    </div>
  );
}
