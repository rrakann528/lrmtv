import { Router } from 'express';
import { URL } from 'url';

const router = Router();

function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
    if (host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (/^10\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^169\.254\./.test(host)) return true;
    if (host.startsWith('fc') || host.startsWith('fd') || host === '::') return true;
    if (!parsed.protocol.startsWith('http')) return true;
    return false;
  } catch { return true; }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Origin, Accept',
};

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  'Accept-Encoding': 'identity',
};

const BRIDGE_SCRIPT = `(function(){
  if(window.__lrmtvBridge)return;
  window.__lrmtvBridge=true;
  var P=window.parent;if(P===window)return;
  var RE=/\\.m3u8|\\.mp4|\\.webm|\\.mkv/i;
  var sent=new Set();
  function abs(u){
    try{return new URL(u,location.href).href}catch(e){return u}
  }
  function report(u,s){
    if(!u||u.length<10)return;
    u=abs(u);
    if(sent.has(u))return;
    sent.add(u);
    try{P.postMessage({type:'lrmtv-video-detected',url:u,source:s},'*')}catch(e){}
  }
  function checkEl(el){
    if(!el||!el.tagName)return;
    var tag=el.tagName;
    if(tag==='VIDEO'||tag==='SOURCE'||tag==='EMBED'){
      var src=el.src||el.getAttribute('src')||'';
      if(RE.test(src))report(src,'element');
      if(tag==='VIDEO'){
        var sources=el.querySelectorAll('source');
        for(var i=0;i<sources.length;i++){
          var ss=sources[i].src||sources[i].getAttribute('src')||'';
          if(RE.test(ss))report(ss,'source');
        }
        if(el.currentSrc&&RE.test(el.currentSrc))report(el.currentSrc,'currentSrc');
      }
    }
  }
  try{
    Object.defineProperty(window,'top',{get:function(){return window},configurable:true});
  }catch(e){}
  var obs=new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var m=muts[i];
      for(var j=0;j<m.addedNodes.length;j++){
        var n=m.addedNodes[j];
        if(n.nodeType!==1)continue;
        checkEl(n);
        if(n.querySelectorAll){
          var els=n.querySelectorAll('video,source,embed');
          for(var k=0;k<els.length;k++)checkEl(els[k]);
        }
      }
      if(m.type==='attributes')checkEl(m.target);
    }
  });
  obs.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  try{
    var desc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
    if(desc&&desc.set){
      Object.defineProperty(HTMLMediaElement.prototype,'src',{
        set:function(v){if(v&&RE.test(v))report(v,'src-set');desc.set.call(this,v)},
        get:function(){return desc.get.call(this)},configurable:true
      });
    }
  }catch(e){}
  var origFetch=window.fetch;
  if(origFetch){
    window.fetch=function(){
      var u=typeof arguments[0]==='string'?arguments[0]:(arguments[0]&&arguments[0].url)||'';
      if(u&&RE.test(u))report(u,'fetch');
      return origFetch.apply(this,arguments);
    };
  }
  var origOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    if(url&&RE.test(String(url)))report(String(url),'xhr');
    return origOpen.apply(this,arguments);
  };
  var els=document.querySelectorAll('video,source,embed');
  for(var i=0;i<els.length;i++)checkEl(els[i]);
  setInterval(function(){
    var vids=document.querySelectorAll('video');
    for(var i=0;i<vids.length;i++){
      if(vids[i].currentSrc&&RE.test(vids[i].currentSrc))report(vids[i].currentSrc,'poll');
      var srcs=vids[i].querySelectorAll('source');
      for(var j=0;j<srcs.length;j++){
        var s=srcs[j].src||srcs[j].getAttribute('src')||'';
        if(RE.test(s))report(s,'poll');
      }
    }
  },2000);
})();`;

router.options('/proxy/page', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

router.get('/proxy/page', async (req, res) => {
  res.set(CORS_HEADERS);
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) { res.status(400).json({ error: 'Missing url param' }); return; }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    new URL(targetUrl);
  } catch {
    res.status(400).json({ error: 'Invalid url' });
    return;
  }

  if (isPrivateUrl(targetUrl)) {
    res.status(403).json({ error: 'Blocked: private/internal URL' });
    return;
  }

  try {
    const parsed = new URL(targetUrl);
    const baseHref = `${parsed.protocol}//${parsed.host}`;

    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      'Referer': `${baseHref}/`,
    };

    const response = await fetch(targetUrl, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Upstream returned ${response.status}` });
      return;
    }

    let html = await response.text();

    const baseTag = `<base href="${baseHref}/">`;
    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch) {
      html = html.replace(headMatch[0], headMatch[0] + baseTag);
    } else {
      html = baseTag + html;
    }

    const bridgeTag = `<script>${BRIDGE_SCRIPT}</script>`;
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, bridgeTag + '</body>');
    } else {
      html += bridgeTag;
    }

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "frame-ancestors 'self'; script-src 'unsafe-inline' 'unsafe-eval' blob: data: *; default-src * blob: data: 'unsafe-inline' 'unsafe-eval'",
    });
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.options('/proxy/page/asset', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

router.get('/proxy/page/asset', async (req, res) => {
  res.set(CORS_HEADERS);
  const rawUrl = req.query.url as string | undefined;
  const rawRef = req.query.ref as string | undefined;
  if (!rawUrl) { res.status(400).json({ error: 'Missing url param' }); return; }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    new URL(targetUrl);
  } catch {
    res.status(400).json({ error: 'Invalid url' });
    return;
  }

  if (isPrivateUrl(targetUrl)) {
    res.status(403).json({ error: 'Blocked: private/internal URL' });
    return;
  }

  try {
    const headers: Record<string, string> = { ...BASE_HEADERS };
    if (rawRef) {
      try { headers['Referer'] = decodeURIComponent(rawRef); } catch {}
    }

    const response = await fetch(targetUrl, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    const ct = response.headers.get('content-type') || 'application/octet-stream';
    res.set('Content-Type', ct);
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');

    const buf = Buffer.from(await response.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
