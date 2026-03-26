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

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  'Accept-Encoding': 'identity',
};

const VIDEO_RE = /(?:https?:)?\/\/[^\s"'<>\)]+\.(?:m3u8|mp4|webm|mkv)(?:\?[^\s"'<>\)]*)?/gi;
const IFRAME_SRC_RE = /<iframe[^>]+src=["']([^"']+)["']/gi;

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  if (isPrivateUrl(url)) return null;
  try {
    const parsed = new URL(url);
    const resp = await fetch(url, {
      headers: { ...BASE_HEADERS, 'Referer': `${parsed.protocol}//${parsed.host}/` },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    return { html, finalUrl: resp.url || url };
  } catch { return null; }
}

function extractVideoUrls(text: string): string[] {
  const matches = text.match(VIDEO_RE) || [];
  const urls = new Set<string>();
  for (const m of matches) {
    let u = m;
    if (u.startsWith('//')) u = 'https:' + u;
    try { new URL(u); urls.add(u); } catch {}
  }
  return [...urls];
}

function extractIframeSrcs(html: string, baseUrl: string): string[] {
  const srcs: string[] = [];
  let match;
  const re = new RegExp(IFRAME_SRC_RE.source, 'gi');
  while ((match = re.exec(html)) !== null) {
    let src = match[1];
    if (!src || src.startsWith('about:') || src.startsWith('javascript:')) continue;
    try {
      if (src.startsWith('//')) src = 'https:' + src;
      else if (src.startsWith('/')) src = new URL(src, baseUrl).href;
      else if (!src.startsWith('http')) src = new URL(src, baseUrl).href;
      srcs.push(src);
    } catch {}
  }
  return srcs;
}

function extractEmbedUrls(html: string, baseUrl: string): string[] {
  const patterns = [
    /(?:src|file|source|url|video_url|stream_url|embed_url)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
    /data-src=["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
    /source\s*:\s*["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
    /file\s*:\s*["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
  ];
  const urls = new Set<string>();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      let u = m[1];
      try {
        if (u.startsWith('//')) u = 'https:' + u;
        else if (!u.startsWith('http')) u = new URL(u, baseUrl).href;
        new URL(u);
        urls.add(u);
      } catch {}
    }
  }
  return [...urls];
}

router.options('/proxy/extract', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

router.get('/proxy/extract', async (req, res) => {
  res.set(CORS_HEADERS);
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) { res.status(400).json({ error: 'Missing url param' }); return; }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    new URL(targetUrl);
  } catch {
    res.status(400).json({ error: 'Invalid url' }); return;
  }

  if (isPrivateUrl(targetUrl)) {
    res.status(403).json({ error: 'Blocked' }); return;
  }

  try {
    const allVideos: string[] = [];
    const visited = new Set<string>();

    const page1 = await fetchPage(targetUrl);
    if (!page1) {
      res.json({ videos: [], embeds: [] }); return;
    }

    visited.add(targetUrl);
    const directVideos = extractVideoUrls(page1.html);
    const embedVideos = extractEmbedUrls(page1.html, page1.finalUrl);
    allVideos.push(...directVideos, ...embedVideos);

    const iframeSrcs = extractIframeSrcs(page1.html, page1.finalUrl);

    const fetchPromises = iframeSrcs
      .filter(src => !visited.has(src) && !isPrivateUrl(src))
      .slice(0, 5)
      .map(async (src) => {
        visited.add(src);
        const page2 = await fetchPage(src);
        if (!page2) return;
        allVideos.push(...extractVideoUrls(page2.html));
        allVideos.push(...extractEmbedUrls(page2.html, page2.finalUrl));

        const innerIframes = extractIframeSrcs(page2.html, page2.finalUrl);
        const innerPromises = innerIframes
          .filter(s => !visited.has(s) && !isPrivateUrl(s))
          .slice(0, 3)
          .map(async (innerSrc) => {
            visited.add(innerSrc);
            const page3 = await fetchPage(innerSrc);
            if (!page3) return;
            allVideos.push(...extractVideoUrls(page3.html));
            allVideos.push(...extractEmbedUrls(page3.html, page3.finalUrl));
          });
        await Promise.allSettled(innerPromises);
      });

    await Promise.allSettled(fetchPromises);

    const uniqueVideos = [...new Set(allVideos)];
    res.json({ videos: uniqueVideos, embeds: iframeSrcs });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});


const ANTI_IFRAME_SCRIPT = `(function(){
  window.__lrmtvRealParent=window.parent;
  try{Object.defineProperty(window,'top',{get:function(){return window},configurable:true})}catch(e){}
  try{Object.defineProperty(window,'parent',{get:function(){return window},configurable:true})}catch(e){}
  try{Object.defineProperty(window,'frameElement',{get:function(){return null},configurable:true})}catch(e){}
  try{Object.defineProperty(window,'self',{get:function(){return window},configurable:true})}catch(e){}
  var PROXY='/api/proxy/page?url=';
  var origCreate=document.createElement.bind(document);
  document.createElement=function(tag){
    var el=origCreate(tag);
    if(tag.toLowerCase()==='iframe'){
      var origSet=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');
      if(origSet&&origSet.set){
        Object.defineProperty(el,'src',{
          set:function(v){
            if(v&&typeof v==='string'&&v.match(/^https?:\\/\\//i)&&v.indexOf('/api/proxy/')!==-1){
              origSet.set.call(this,v);
            }else if(v&&typeof v==='string'&&v.match(/^https?:\\/\\//i)){
              origSet.set.call(this,PROXY+encodeURIComponent(v));
            }else{
              origSet.set.call(this,v);
            }
          },
          get:origSet.get?function(){return origSet.get.call(this)}:undefined,
          configurable:true
        });
      }
    }
    return el;
  };
  try{
    var ifrDesc=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');
    if(ifrDesc&&ifrDesc.set){
      var origIfrSet=ifrDesc.set;
      Object.defineProperty(HTMLIFrameElement.prototype,'src',{
        set:function(v){
          if(v&&typeof v==='string'&&v.match(/^https?:\\/\\//i)&&v.indexOf('/api/proxy/')===-1){
            origIfrSet.call(this,PROXY+encodeURIComponent(v));
          }else{
            origIfrSet.call(this,v);
          }
        },
        get:ifrDesc.get,
        configurable:true
      });
    }
  }catch(e){}
  try{
    var setAttrOrig=Element.prototype.setAttribute;
    Element.prototype.setAttribute=function(name,value){
      if(this.tagName==='IFRAME'&&name.toLowerCase()==='src'&&value&&typeof value==='string'&&value.match(/^https?:\\/\\//i)&&value.indexOf('/api/proxy/')===-1){
        return setAttrOrig.call(this,name,PROXY+encodeURIComponent(value));
      }
      return setAttrOrig.call(this,name,value);
    };
  }catch(e){}
})();`;

const BRIDGE_SCRIPT = `(function(){
  if(window.__lrmtvBridge)return;
  window.__lrmtvBridge=true;
  var P=window.__lrmtvRealParent||window.parent;
  var RE=/\\.m3u8|\\.mp4|\\.webm|\\.mkv/i;
  var sent=new Set();
  window.addEventListener('message',function(ev){
    if(ev.data&&ev.data.type==='lrmtv-video-detected'&&ev.data.url&&P!==window){
      try{P.postMessage(ev.data,'*')}catch(e){}
    }
  });
  function abs(u){
    try{return new URL(u,location.href).href}catch(e){return u}
  }
  function report(u,s){
    if(!u||u.length<10)return;
    u=abs(u);
    if(u.indexOf('/api/proxy/')!==-1){
      try{var pu=new URL(u);var raw=pu.searchParams.get('url');if(raw)u=raw;}catch(e){}
    }
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
  try{
    var origAddSrc=window.MediaSource&&window.MediaSource.isTypeSupported;
    var origURL=window.URL.createObjectURL;
    if(origURL){
      window.URL.createObjectURL=function(obj){
        var result=origURL.call(this,obj);
        return result;
      };
    }
  }catch(e){}
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

    html = html.replace(/<script[^>]*src=["'][^"']*sbx\.js["'][^>]*><\/script>/gi, '');
    html = html.replace(/dtc_sbx\s*\(\s*\)/g, '');
    html = html.replace(/function\s+dtc_sbx\s*\(\s*\)\s*\{[\s\S]*?\}\s*dtc_sbx\s*\(\s*\)\s*;?/g, '');

    html = html.replace(/<iframe([^>]*)\ssrc=["'](https?:\/\/[^"']+)["']/gi, (_match, attrs, iframeSrc) => {
      const proxied = `/api/proxy/page?url=${encodeURIComponent(iframeSrc)}`;
      return `<iframe${attrs} src="${proxied}"`;
    });

    const antiIframeTag = `<script>${ANTI_IFRAME_SCRIPT}</script>`;
    const baseTag = `<base href="${baseHref}/">`;
    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch) {
      html = html.replace(headMatch[0], headMatch[0] + antiIframeTag + baseTag);
    } else {
      html = antiIframeTag + baseTag + html;
    }

    const bridgeTag = `<script>${BRIDGE_SCRIPT}</script>`;
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, bridgeTag + '</body>');
    } else {
      html += bridgeTag;
    }

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Type-Options');
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
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
