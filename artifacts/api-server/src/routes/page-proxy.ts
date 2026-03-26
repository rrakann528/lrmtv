import { Router } from 'express';
import { URL } from 'url';
import { extractVideoUrls as browserExtract } from '../lib/browser-extract.js';
import { extractLimiter } from '../middlewares/security.js';

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

// ── /proxy/extract — Virtual browser + static fallback ────────────────────────
router.options('/proxy/extract', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

router.get('/proxy/extract', extractLimiter, async (req, res) => {
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
    let method = 'none';
    const allVideos: string[] = [];

    try {
      const browserVideos = await browserExtract(targetUrl, 30000);
      if (browserVideos.length > 0) {
        allVideos.push(...browserVideos);
        method = 'browser';
      }
    } catch (browserErr) {
      console.error('[extract] browser extraction failed:', browserErr);
    }

    if (allVideos.length === 0) {
      const visited = new Set<string>();
      const page1 = await fetchPage(targetUrl);
      if (page1) {
        visited.add(targetUrl);
        allVideos.push(...extractVideoUrls(page1.html));
        allVideos.push(...extractEmbedUrls(page1.html, page1.finalUrl));
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
          });
        await Promise.allSettled(fetchPromises);
        if (allVideos.length > 0) method = 'static';
      }
    }

    const uniqueVideos = [...new Set(allVideos)];
    res.json({ videos: uniqueVideos, method });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Bridge script injected into proxied pages ─────────────────────────────────
const BRIDGE_SCRIPT = `(function(){
  var RP=window.parent;
  try{Object.defineProperty(window,'top',{get:function(){return window},configurable:true})}catch(e){}
  try{Object.defineProperty(window,'parent',{get:function(){return window},configurable:true})}catch(e){}
  try{Object.defineProperty(window,'frameElement',{get:function(){return null},configurable:true})}catch(e){}
  try{Object.defineProperty(window,'self',{get:function(){return window},configurable:true})}catch(e){}
  var RE=/\\.m3u8|\\.mp4|\\.webm|\\.mkv/i;
  var sent=new Set();
  function abs(u){try{return new URL(u,location.href).href}catch(e){return u}}
  function report(u){
    if(!u||u.length<10)return;
    u=abs(u);
    if(sent.has(u))return;
    sent.add(u);
    try{RP.postMessage({type:'lrmtv-video-detected',url:u},'*')}catch(e){}
  }
  window.__lrmtvReport=report;
  window.addEventListener('message',function(ev){
    if(ev.data&&ev.data.type==='lrmtv-video-detected'&&ev.data.url){
      try{RP.postMessage(ev.data,'*')}catch(e){}
    }
  });
  var origFetch=window.fetch;
  if(origFetch){
    window.fetch=function(){
      var u=typeof arguments[0]==='string'?arguments[0]:(arguments[0]&&arguments[0].url)||'';
      if(u&&RE.test(String(u)))report(String(u));
      var p=origFetch.apply(this,arguments);
      try{p.then(function(resp){
        try{
          var ct=resp.headers.get('content-type')||'';
          if(ct.indexOf('json')!==-1||ct.indexOf('text')!==-1){
            resp.clone().text().then(function(body){
              var m=body.match(/(?:https?:)?\\/\\/[^\\s"'<>\\)]+\\.(?:m3u8|mp4|webm)(?:\\?[^\\s"'<>\\)]*)*/gi);
              if(m)m.forEach(function(mu){if(mu.startsWith('//'))mu='https:'+mu;report(mu)});
            }).catch(function(){});
          }
        }catch(e){}
      }).catch(function(){})}catch(e){}
      return p;
    };
  }
  var origOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    if(url&&RE.test(String(url)))report(String(url));
    return origOpen.apply(this,arguments);
  };
  try{
    var desc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
    if(desc&&desc.set){
      var origSet=desc.set,origGet=desc.get;
      Object.defineProperty(HTMLMediaElement.prototype,'src',{
        set:function(v){if(v&&RE.test(v))report(v);origSet.call(this,v)},
        get:function(){return origGet.call(this)},configurable:true
      });
    }
  }catch(e){}
  var obs=new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n.nodeType!==1)return;
        if(n.tagName==='VIDEO'||n.tagName==='SOURCE'){
          var s=n.src||n.getAttribute('src')||'';
          if(RE.test(s))report(s);
          if(n.currentSrc&&RE.test(n.currentSrc))report(n.currentSrc);
        }
        var vids=n.querySelectorAll&&n.querySelectorAll('video,source');
        if(vids)vids.forEach(function(v){
          var s=v.src||v.getAttribute('src')||'';
          if(RE.test(s))report(s);
          if(v.currentSrc&&RE.test(v.currentSrc))report(v.currentSrc);
        });
      });
    });
  });
  obs.observe(document.documentElement||document,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  setInterval(function(){
    document.querySelectorAll('video').forEach(function(v){
      if(v.currentSrc&&RE.test(v.currentSrc))report(v.currentSrc);
      if(v.src&&RE.test(v.src))report(v.src);
    });
  },1500);
})();`;

// ── /proxy/page — Interactive iframe proxy ─────────────────────────────────────
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
    res.status(400).json({ error: 'Invalid url' }); return;
  }

  if (isPrivateUrl(targetUrl)) {
    res.status(403).json({ error: 'Blocked' }); return;
  }

  try {
    const parsed = new URL(targetUrl);
    const baseHref = `${parsed.protocol}//${parsed.host}`;

    const response = await fetch(targetUrl, {
      headers: { ...BASE_HEADERS, 'Referer': `${baseHref}/` },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Upstream returned ${response.status}` });
      return;
    }

    let html = await response.text();

    // strip anti-iframe detection
    html = html.replace(/<script[^>]*src=["'][^"']*sbx\.js["'][^>]*><\/script>/gi, '');
    html = html.replace(/dtc_sbx\s*\(\s*\)/g, '');

    // proxy nested iframes through us
    html = html.replace(/<iframe([^>]*)\ssrc=["'](https?:\/\/[^"']+)["']/gi, (_m, attrs, iframeSrc) => {
      return `<iframe${attrs} src="/api/proxy/page?url=${encodeURIComponent(iframeSrc)}"`;
    });

    const bridgeTag = `<script>${BRIDGE_SCRIPT}</script>`;
    const baseTag = `<base href="${baseHref}/">`;
    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch) {
      html = html.replace(headMatch[0], headMatch[0] + bridgeTag + baseTag);
    } else {
      html = bridgeTag + baseTag + html;
    }

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Type-Options');
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
