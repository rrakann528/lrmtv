const BANNER_ZONE_ID = '11082246';

/*
 * sandbox="allow-scripts allow-popups"
 *   ✅ Scripts run inside the iframe (so the ad loads)
 *   ✅ Clicking the ad itself opens the ad URL in a new tab
 *   ❌ iframe cannot access parent.document → no click-hijacking
 *   ❌ iframe cannot navigate the parent window → no click-hijacking
 */
const AD_SRCDOC = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;overflow:hidden}body{width:468px;height:60px;background:transparent}</style></head><body><script src="//acscdn.com/script/aclib.js"><\/script><script>window.onload=function(){try{aclib.runBanner({zoneId:'${BANNER_ZONE_ID}'});}catch(e){}}<\/script></body></html>`;

interface Props {
  bottom?: number;
  inline?: boolean;
}

function AdIframe() {
  return (
    <iframe
      srcDoc={AD_SRCDOC}
      sandbox="allow-scripts allow-popups"
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
      flexShrink: 0,
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
