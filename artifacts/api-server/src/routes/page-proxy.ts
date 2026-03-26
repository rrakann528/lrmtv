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
const IFRAME_SRC_RE = /<iframe[^>]*\ssrc=["']([^"']+)["']/gi;

// Known streaming embed hosts — fetched with parent Referer for better results
const EMBED_HOSTS = [
  'filemoon', 'doodstream', 'dood', 'streamtape', 'voe.sx', 'mixdrop',
  'upstream', 'streamsb', 'fembed', 'vidcloud', 'vidstream', 'vizcloud',
  'mycloud', 'mcloud', 'embedsito', 'rabbitstream', 'kwik', 'mp4upload',
  'streamlare', 'streamhide', 'guccihide', 'vidhide', 'embedrise',
  'uqloads', 'fileone', 'turboplay', 'vudeo', 'filelions', 'brainly',
  'okru', 'ok.ru', 'dailymotion', 'rumble', 'streamwish', 'wish',
];

function isEmbedHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return EMBED_HOSTS.some(e => h.includes(e));
  } catch { return false; }
}

async function fetchPage(url: string, referer?: string): Promise<{ html: string; finalUrl: string } | null> {
  if (isPrivateUrl(url)) return null;
  try {
    const parsed = new URL(url);
    const resp = await fetch(url, {
      headers: {
        ...BASE_HEADERS,
        'Referer': referer || `${parsed.protocol}//${parsed.host}/`,
        'Origin': referer ? new URL(referer).origin : `${parsed.protocol}//${parsed.host}`,
      },
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
    if (!src || src.startsWith('about:') || src.startsWith('javascript:') || src.startsWith('data:')) continue;
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
    // Video file patterns
    /(?:src|file|source|url|video_url|stream_url|embed_url|hls_url|m3u8)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
    /data-(?:src|file|url|video)=["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
    // JSON-style patterns
    /"(?:file|src|url|source|hls|stream)"\s*:\s*"([^"]+\.(?:m3u8|mp4|webm)[^"]*)"/gi,
    // Unquoted patterns
    /(?:file|src|url|source):\s*'([^']+\.(?:m3u8|mp4|webm)[^']*)'/gi,
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

// Try to decode base64 atob() calls which hide video URLs
function extractBase64Urls(html: string): string[] {
  const urls: string[] = [];
  const atobRe = /atob\s*\(\s*["']([A-Za-z0-9+/=]{20,})["']\s*\)/g;
  let m;
  while ((m = atobRe.exec(html)) !== null) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
      const videoMatches = decoded.match(/https?:\/\/[^\s"'<>)]+\.(?:m3u8|mp4|webm)/gi);
      if (videoMatches) urls.push(...videoMatches);
      // Also check if decoded is an embed URL
      if (/^https?:\/\//.test(decoded) && !decoded.includes('\n')) {
        urls.push(decoded.trim());
      }
    } catch {}
  }
  return urls;
}

// Extract embed URLs from script tags (common in streaming sites)
function extractScriptEmbedUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const embedPatterns = [
    // Common embed URL patterns in scripts
    /(?:playerUrl|embedUrl|iframeSrc|embedSrc|playerSrc)\s*[=:]\s*["']([^"']+)["']/gi,
    // Iframe creation in scripts
    /iframe\.src\s*=\s*["']([^"']+)["']/gi,
    /createElement\(['"]iframe['"]\)[^;]*\.src\s*=\s*["']([^"']+)["']/gi,
    // Direct embed domain mentions
    new RegExp(`["'](https?://(?:${EMBED_HOSTS.join('|').replace(/\./g, '\\.')})\\.[^"'\\s]+)["']`, 'gi'),
  ];
  for (const re of embedPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      let u = m[1];
      try {
        if (u.startsWith('//')) u = 'https:' + u;
        else if (u.startsWith('/')) u = new URL(u, baseUrl).href;
        else if (!u.startsWith('http')) continue;
        new URL(u);
        if (!isPrivateUrl(u)) urls.push(u);
      } catch {}
    }
  }
  return urls;
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
        const parentReferer = targetUrl;

        // Level 1: extract from main page
        allVideos.push(...extractVideoUrls(page1.html));
        allVideos.push(...extractEmbedUrls(page1.html, page1.finalUrl));
        allVideos.push(...extractBase64Urls(page1.html));

        // Collect all candidate embed URLs from L1
        const iframeSrcs = extractIframeSrcs(page1.html, page1.finalUrl);
        const scriptEmbeds = extractScriptEmbedUrls(page1.html, page1.finalUrl);
        const candidateUrls = [...new Set([...iframeSrcs, ...scriptEmbeds])];

        // Sort: known embed hosts first (fetch with parent referer)
        const embedFirst = [
          ...candidateUrls.filter(u => isEmbedHost(u)),
          ...candidateUrls.filter(u => !isEmbedHost(u)),
        ].filter(src => !visited.has(src) && !isPrivateUrl(src)).slice(0, 8);

        const fetchPromises = embedFirst.map(async (src) => {
          visited.add(src);
          // Pass parent page as referer — critical for embed sites
          const page2 = await fetchPage(src, parentReferer);
          if (!page2) return;
          allVideos.push(...extractVideoUrls(page2.html));
          allVideos.push(...extractEmbedUrls(page2.html, page2.finalUrl));
          allVideos.push(...extractBase64Urls(page2.html));

          // Level 3: go one more level if it's an embed host
          if (isEmbedHost(src)) {
            const l3iframes = extractIframeSrcs(page2.html, page2.finalUrl)
              .filter(s => !visited.has(s) && !isPrivateUrl(s)).slice(0, 3);
            const l3promises = l3iframes.map(async (s3) => {
              visited.add(s3);
              const page3 = await fetchPage(s3, src);
              if (!page3) return;
              allVideos.push(...extractVideoUrls(page3.html));
              allVideos.push(...extractEmbedUrls(page3.html, page3.finalUrl));
              allVideos.push(...extractBase64Urls(page3.html));
            });
            await Promise.allSettled(l3promises);
          }
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
// This runs inside EVERY proxied page (including nested iframes).
// It hooks all network activity and video element sources, then relays
// detected video URLs up the iframe chain via postMessage.
const BRIDGE_SCRIPT = `(function(){
  // Keep a reference to the real parent before any overrides
  var RP=window.parent;
  var _top=window.top;

  // ── Anti-iframe-detection — make the page think it's top-level ──────────────
  try{Object.defineProperty(window,'top',{get:function(){return window},configurable:true})}catch(e){}
  try{Object.defineProperty(window,'parent',{get:function(){return window},configurable:true})}catch(e){}
  try{Object.defineProperty(window,'frameElement',{get:function(){return null},configurable:true})}catch(e){}
  try{Object.defineProperty(window,'self',{get:function(){return window},configurable:true})}catch(e){}

  // ── Pattern matchers ─────────────────────────────────────────────────────────
  // Extension-based
  var RE_EXT=/\\.m3u8|\\.mp4|\\.webm|\\.mkv|\\.ts/i;
  // HLS/DASH hints without extension
  var RE_HLS=/\\/hls\\/|\\/dash\\/|master\\.m3u8|playlist\\.m3u8|index\\.m3u8|chunklist|\\/manifest\\.mpd|type=m3u8|format=hls/i;
  // Full URL pattern in text
  var RE_URL=/(?:https?:)?\\/\\/[^\\s"'<>\\)\\]]+\\.(?:m3u8|mp4|webm|ts|mkv)(?:\\?[^\\s"'<>\\)\\]]*)*/gi;

  function isVideoUrl(u){
    if(!u||typeof u!=='string'||u.length<8)return false;
    return RE_EXT.test(u)||RE_HLS.test(u);
  }

  var sent=new Set();
  function abs(u){
    try{
      if(u.startsWith('blob:'))return u;
      return new URL(u,location.href).href;
    }catch(e){return u}
  }
  function report(u){
    if(!u||typeof u!=='string'||u.length<10)return;
    if(u.startsWith('data:'))return;
    u=abs(u);
    if(sent.has(u))return;
    sent.add(u);
    try{RP.postMessage({type:'lrmtv-video-detected',url:u},'*')}catch(e){}
    try{_top.postMessage({type:'lrmtv-video-detected',url:u},'*')}catch(e){}
  }

  // Scan arbitrary text for video URLs
  function scanText(text){
    if(!text||typeof text!=='string')return;
    var m=text.match(RE_URL);
    if(m)m.forEach(function(mu){if(mu.startsWith('//'))mu='https:'+mu;report(mu)});
  }

  window.__lrmtvReport=report;

  // Relay postMessages from nested iframes up the chain
  window.addEventListener('message',function(ev){
    if(ev.data&&ev.data.type==='lrmtv-video-detected'&&ev.data.url){
      report(ev.data.url);
    }
  });

  // ── Hook fetch() ─────────────────────────────────────────────────────────────
  var origFetch=window.fetch;
  if(origFetch){
    window.fetch=function(){
      var u=typeof arguments[0]==='string'?arguments[0]:(arguments[0]&&arguments[0].url)||'';
      u=String(u);
      if(isVideoUrl(u))report(u);
      var p=origFetch.apply(this,arguments);
      p.then(function(resp){
        try{
          var respUrl=resp.url||u;
          if(isVideoUrl(respUrl))report(respUrl);
          var ct=resp.headers.get('content-type')||'';
          if(ct.indexOf('mpegurl')!==-1||ct.indexOf('dash+xml')!==-1){report(respUrl)}
          if(ct.indexOf('json')!==-1||ct.indexOf('text')!==-1||ct.indexOf('javascript')!==-1){
            resp.clone().text().then(function(body){scanText(body)}).catch(function(){});
          }
        }catch(e){}
      }).catch(function(){});
      return p;
    };
  }

  // ── Hook XMLHttpRequest ──────────────────────────────────────────────────────
  var origOpen=XMLHttpRequest.prototype.open;
  var origSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url){
    this.__lrmtvUrl=String(url||'');
    if(isVideoUrl(this.__lrmtvUrl))report(this.__lrmtvUrl);
    return origOpen.apply(this,arguments);
  };
  XMLHttpRequest.prototype.send=function(){
    var xhr=this;
    var origOnload=xhr.onload;
    xhr.addEventListener('load',function(){
      try{
        var respUrl=xhr.responseURL||xhr.__lrmtvUrl||'';
        if(isVideoUrl(respUrl))report(respUrl);
        var ct=xhr.getResponseHeader('content-type')||'';
        if(ct.indexOf('mpegurl')!==-1||ct.indexOf('dash+xml')!==-1){report(respUrl)}
        var body=xhr.responseText||'';
        if(body.length<500000)scanText(body);
      }catch(e){}
    });
    return origSend.apply(this,arguments);
  };

  // ── Hook HTMLMediaElement.src ────────────────────────────────────────────────
  try{
    var desc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
    if(desc&&desc.set){
      var origSet=desc.set,origGet=desc.get;
      Object.defineProperty(HTMLMediaElement.prototype,'src',{
        set:function(v){
          if(v&&typeof v==='string'&&!v.startsWith('blob:')&&(isVideoUrl(v)))report(v);
          origSet.call(this,v);
        },
        get:function(){return origGet.call(this)},
        configurable:true
      });
    }
  }catch(e){}

  // ── Hook currentSrc (read-only property on media elements) ──────────────────
  var _origPlay=HTMLMediaElement.prototype.play;
  if(_origPlay){
    HTMLMediaElement.prototype.play=function(){
      try{if(this.currentSrc&&isVideoUrl(this.currentSrc))report(this.currentSrc);}catch(e){}
      var r=_origPlay.apply(this,arguments);
      if(r&&r.then){r.then(function(){try{if(this.currentSrc&&isVideoUrl(this.currentSrc))report(this.currentSrc);}catch(e){}}.bind(this)).catch(function(){});}
      return r;
    };
  }

  // ── Hook window.open (some players open video in new tab) ───────────────────
  var origOpen2=window.open;
  window.open=function(url){
    if(url&&isVideoUrl(String(url)))report(String(url));
    return origOpen2.apply(this,arguments);
  };

  // ── MutationObserver — watch for dynamically added video/source elements ─────
  var obs=new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n.nodeType!==1)return;
        var el=n;
        if(el.tagName==='VIDEO'||el.tagName==='AUDIO'){
          if(el.src&&isVideoUrl(el.src))report(el.src);
          if(el.currentSrc&&isVideoUrl(el.currentSrc))report(el.currentSrc);
          el.addEventListener('loadstart',function(){
            if(this.currentSrc&&isVideoUrl(this.currentSrc))report(this.currentSrc);
          });
          el.addEventListener('canplay',function(){
            if(this.currentSrc&&isVideoUrl(this.currentSrc))report(this.currentSrc);
          });
        }
        if(el.tagName==='SOURCE'){
          var s=el.src||el.getAttribute('src')||'';
          if(isVideoUrl(s))report(s);
        }
        // Recurse into added subtrees
        var vids=el.querySelectorAll&&el.querySelectorAll('video,audio,source');
        if(vids)vids.forEach(function(v){
          var s=v.src||v.getAttribute('src')||'';
          if(s&&isVideoUrl(s))report(s);
          if(v.currentSrc&&isVideoUrl(v.currentSrc))report(v.currentSrc);
        });
      });
      // Also watch attribute changes
      if(m.type==='attributes'&&m.attributeName==='src'){
        var el2=m.target;
        var s2=el2.getAttribute&&el2.getAttribute('src')||'';
        if(s2&&isVideoUrl(s2))report(s2);
      }
    });
  });
  obs.observe(document.documentElement||document.body||document,{childList:true,subtree:true,attributes:true,attributeFilter:['src','data-src','data-url']});

  // ── Scan existing video elements on load ─────────────────────────────────────
  function scanExisting(){
    document.querySelectorAll('video,audio').forEach(function(v){
      if(v.currentSrc&&isVideoUrl(v.currentSrc))report(v.currentSrc);
      if(v.src&&isVideoUrl(v.src))report(v.src);
      v.querySelectorAll('source').forEach(function(s){
        if(s.src&&isVideoUrl(s.src))report(s.src);
      });
    });
    // Scan script tags for embedded URLs
    document.querySelectorAll('script:not([src])').forEach(function(s){
      scanText(s.textContent||'');
    });
    // Scan data attributes
    document.querySelectorAll('[data-src],[data-url],[data-video],[data-file],[data-stream],[data-hls]').forEach(function(el){
      ['data-src','data-url','data-video','data-file','data-stream','data-hls'].forEach(function(a){
        var v=el.getAttribute(a);
        if(v&&isVideoUrl(v))report(v);
      });
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',scanExisting);
  } else {
    scanExisting();
  }
  window.addEventListener('load',scanExisting);

  // ── Polling fallback every 1.5 seconds ───────────────────────────────────────
  setInterval(function(){
    document.querySelectorAll('video,audio').forEach(function(v){
      if(v.currentSrc&&isVideoUrl(v.currentSrc))report(v.currentSrc);
      if(v.src&&isVideoUrl(v.src))report(v.src);
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
