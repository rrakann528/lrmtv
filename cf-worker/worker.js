const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Origin, Accept',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
};

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',
};

function candidateReferers(targetUrl) {
  const parsed = new URL(targetUrl);
  const candidates = [
    '',
    `${parsed.protocol}//${parsed.hostname}/`,
  ];
  const domainRe = /([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/gi;
  const pathStr = parsed.pathname + parsed.search;
  let m;
  while ((m = domainRe.exec(pathStr)) !== null) {
    const candidate = `https://${m[1]}/`;
    if (!candidates.includes(candidate) && !m[1].startsWith(parsed.hostname)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

async function fetchWithRefererFallback(url, extraHeaders = {}, timeoutMs = 15000) {
  const referers = candidateReferers(url);
  let last;
  for (const referer of referers) {
    const headers = { ...BASE_HEADERS, ...extraHeaders };
    if (referer) headers['Referer'] = referer;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.ok || response.status === 206) return { response, referer };
      last = response;
    } catch {
    }
  }
  return { response: last, referer: '' };
}

function proxyUri(workerOrigin, uri, baseDir, referer) {
  const absolute = uri.startsWith('http') ? uri : new URL(uri, baseDir).href;
  let p = `${workerOrigin}/?url=${encodeURIComponent(absolute)}&mode=segment`;
  if (referer) p += `&ref=${encodeURIComponent(referer)}`;
  return p;
}

function rewriteManifest(workerOrigin, text, baseDir, referer) {
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (!trimmed.startsWith('#')) {
      return proxyUri(workerOrigin, trimmed, baseDir, referer);
    }

    if (trimmed.startsWith('#EXT-X-KEY')) {
      return line.replace(/URI="([^"]+)"/, (_match, uri) =>
        `URI="${proxyUri(workerOrigin, uri, baseDir, referer)}"`,
      );
    }

    if (trimmed.startsWith('#EXT-X-MAP')) {
      return line.replace(/URI="([^"]+)"/, (_match, uri) =>
        `URI="${proxyUri(workerOrigin, uri, baseDir, referer)}"`,
      );
    }

    if (trimmed.startsWith('#EXT-X-MEDIA') && trimmed.includes('URI=')) {
      return line.replace(/URI="([^"]+)"/, (_match, uri) =>
        `URI="${proxyUri(workerOrigin, uri, baseDir, referer)}"`,
      );
    }

    return line;
  }).join('\n');
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const workerOrigin = url.origin;
    const targetUrl = url.searchParams.get('url');
    const mode = url.searchParams.get('mode') || 'full';
    const refParam = url.searchParams.get('ref') || '';

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing url param' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    let decodedUrl;
    try {
      decodedUrl = decodeURIComponent(targetUrl);
      new URL(decodedUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid url' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    try {
      if (mode === 'manifest') {
        return await handleManifest(workerOrigin, decodedUrl);
      }

      if (mode === 'full') {
        return await handleFull(workerOrigin, decodedUrl);
      }

      if (mode === 'segment') {
        return await handleSegment(decodedUrl, refParam, request);
      }

      if (mode === 'video') {
        return await handleVideo(decodedUrl, refParam, request);
      }

      return await handleFull(workerOrigin, decodedUrl);
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, {
        status: 502,
        headers: CORS_HEADERS,
      });
    }
  },
};

async function handleManifest(workerOrigin, targetUrl) {
  const { response, referer } = await fetchWithRefererFallback(targetUrl);
  if (!response || !response.ok) {
    return new Response('Upstream error', {
      status: response?.status || 502,
      headers: CORS_HEADERS,
    });
  }

  const text = await response.text();
  const baseDir = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
  const rewritten = rewriteManifest(workerOrigin, text, baseDir, referer);

  return new Response(rewritten, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store',
    },
  });
}

async function handleFull(workerOrigin, targetUrl) {
  const { response, referer } = await fetchWithRefererFallback(targetUrl);
  if (!response || !response.ok) {
    return new Response('Upstream error', {
      status: response?.status || 502,
      headers: CORS_HEADERS,
    });
  }

  const ct = (response.headers.get('content-type') || '').toLowerCase();
  const isM3u8 = ct.includes('mpegurl') || ct.includes('m3u8') || targetUrl.toLowerCase().includes('.m3u8');

  if (isM3u8) {
    const text = await response.text();
    const baseDir = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
    const rewritten = rewriteManifest(workerOrigin, text, baseDir, referer);
    return new Response(rewritten, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache, no-store',
      },
    });
  }

  const headers = { ...CORS_HEADERS };
  if (response.headers.get('content-type')) headers['Content-Type'] = response.headers.get('content-type');
  if (response.headers.get('content-length')) headers['Content-Length'] = response.headers.get('content-length');
  headers['Cache-Control'] = 'max-age=30';

  return new Response(response.body, { headers });
}

async function handleSegment(targetUrl, refParam, request) {
  const knownReferer = refParam ? decodeURIComponent(refParam) : '';
  const isPlaylist = targetUrl.toLowerCase().includes('.m3u8');
  const extra = {};
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) extra['Range'] = rangeHeader;

  let upstreamRes;
  let usedReferer = knownReferer;

  if (knownReferer) {
    const headers = { ...BASE_HEADERS, Referer: knownReferer, ...extra };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    upstreamRes = await fetch(targetUrl, { headers, redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
  } else {
    const result = await fetchWithRefererFallback(targetUrl, extra, 20000);
    upstreamRes = result.response;
    usedReferer = result.referer;
  }

  if (!upstreamRes || !upstreamRes.ok) {
    return new Response('Upstream error', {
      status: upstreamRes?.status || 502,
      headers: CORS_HEADERS,
    });
  }

  if (isPlaylist) {
    const text = await upstreamRes.text();
    const baseDir = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
    const workerOrigin = new URL(request.url).origin;
    const rewritten = rewriteManifest(workerOrigin, text, baseDir, usedReferer);
    return new Response(rewritten, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      },
    });
  }

  const upstreamCt = upstreamRes.headers.get('content-type') || '';
  const contentType = (upstreamCt.startsWith('text/') || upstreamCt === '') ? 'video/mp2t' : upstreamCt;
  const headers = { ...CORS_HEADERS, 'Content-Type': contentType, 'Cache-Control': 'max-age=30' };
  const cl = upstreamRes.headers.get('content-length');
  if (cl) headers['Content-Length'] = cl;

  return new Response(upstreamRes.body, { headers });
}

async function handleVideo(targetUrl, refParam, request) {
  const knownReferer = refParam ? decodeURIComponent(refParam) : '';
  const extra = {};
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) extra['Range'] = rangeHeader;

  let upstreamRes;

  if (knownReferer) {
    const headers = { ...BASE_HEADERS, Referer: knownReferer, ...extra };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    upstreamRes = await fetch(targetUrl, { headers, redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
  } else {
    const result = await fetchWithRefererFallback(targetUrl, extra, 20000);
    upstreamRes = result.response;
  }

  if (!upstreamRes || (!upstreamRes.ok && upstreamRes.status !== 206)) {
    return new Response('Upstream error', {
      status: upstreamRes?.status || 502,
      headers: CORS_HEADERS,
    });
  }

  const headers = {
    ...CORS_HEADERS,
    'Content-Type': upstreamRes.headers.get('content-type') || 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  const cl = upstreamRes.headers.get('content-length');
  const cr = upstreamRes.headers.get('content-range');
  if (cl) headers['Content-Length'] = cl;
  if (cr) headers['Content-Range'] = cr;

  return new Response(upstreamRes.body, {
    status: upstreamRes.status === 206 ? 206 : 200,
    headers,
  });
}
