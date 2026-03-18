interface Props {
  bottom?: number;
  inline?: boolean;
}

function AdIframe() {
  return (
    <iframe
      src="/ad-banner.html"
      sandbox="allow-scripts allow-popups allow-same-origin"
      scrolling="no"
      style={{ width: 468, height: 60, border: 0, display: 'block', flexShrink: 0 }}
      title="ad"
    />
  );
}

export default function AdBar({ bottom = 0, inline = false }: Props) {
  if (inline) {
    return (
      <div style={{
        width: '100%',
        height: 60,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,10,20,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}>
        <AdIframe />
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom,
      left: 0,
      right: 0,
      zIndex: 25,
      height: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(10,10,20,0.95)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden',
    }}>
      <AdIframe />
    </div>
  );
}
