/*
 * AdBanner — clean, isolated banner ad component.
 *
 * Strategy:
 *  • Runs inside a sandboxed iframe (srcdoc) with null origin.
 *  • sandbox="allow-scripts allow-popups" — scripts run, ad clicks open new tab.
 *  • NO allow-same-origin → errors from aclib never reach the parent page.
 *  • NO allow-top-navigation → impossible to hijack parent-page navigation.
 *  • Script tags inside the iframe bypass CORS, so acscdn.com loads normally.
 */

const ZONE = '11082246';

const SRCDOC = `<!DOCTYPE html>
<html>
<head>
<style>
  *,html,body{margin:0;padding:0;overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;
       width:100%;height:60px;background:transparent}
</style>
</head>
<body>
<script>
  /* globals aclib expects */
  var ua=navigator.userAgent;
  window.isIos=/iPad|iPhone|iPod/.test(ua)&&!window.MSStream;
  window.isSafari=/^((?!chrome|android).)*safari/i.test(ua);
  window.isAndroid=/android/i.test(ua);
  /* suppress internal crashes */
  window.onerror=function(){return true;};
  window.addEventListener('unhandledrejection',function(e){e.preventDefault();});
<\/script>
<script src="//acscdn.com/script/aclib.js"><\/script>
<script>
  window.addEventListener('load',function(){
    try{aclib.runBanner({zoneId:'${ZONE}'});}catch(e){}
  });
<\/script>
</body>
</html>`;

interface Props {
  /** fixed positioning: distance from bottom in px */
  bottom?: number;
  /** inline mode: renders as a block element (inside sidebar etc.) */
  inline?: boolean;
}

function BannerIframe() {
  return (
    <iframe
      srcDoc={SRCDOC}
      sandbox="allow-scripts allow-popups"
      scrolling="no"
      style={{ width: 468, height: 60, border: 0, display: 'block', flexShrink: 0 }}
      title="advertisement"
    />
  );
}

export default function AdBanner({ bottom = 0, inline = false }: Props) {
  const wrapStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(10,10,20,0.95)',
    overflow: 'hidden',
    height: 60,
    flexShrink: 0,
    ...(inline
      ? { width: '100%', borderBottom: '1px solid rgba(255,255,255,0.06)' }
      : {
          position: 'fixed',
          bottom,
          left: 0,
          right: 0,
          zIndex: 25,
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }),
  };

  return (
    <div style={wrapStyle}>
      <BannerIframe />
    </div>
  );
}
