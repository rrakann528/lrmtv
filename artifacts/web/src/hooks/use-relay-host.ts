import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';

export function useRelayHost(socket: Socket | null, enabled: boolean) {
  useEffect(() => {
    if (!socket || !enabled) return;

    // Server forwards relay:fetch-for-dj to this socket when it needs the DJ's
    // browser to fetch a URL directly (preserving the DJ's IP so IP-locked CDNs
    // accept the request). Works in browsers/apps that bypass CORS (e.g. Web
    // Video Cast WKWebView). Regular browsers will get a CORS error but the
    // server-side fallback path will still run concurrently.
    const handleFetch = async (data: { requestId: string; url: string }) => {
      if (!data?.requestId || !data?.url) return;

      try {
        const res = await fetch(data.url, {
          headers: {
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        });

        if (!res.ok) {
          socket.emit('relay:dj-error', { requestId: data.requestId, status: res.status });
          return;
        }

        const contentType = res.headers.get('content-type') || 'video/mp2t';
        const buffer = await res.arrayBuffer();
        socket.emit('relay:dj-response', {
          requestId: data.requestId,
          data: buffer,
          contentType,
        });
      } catch {
        socket.emit('relay:dj-error', { requestId: data.requestId, status: 0 });
      }
    };

    socket.on('relay:fetch-for-dj', handleFetch);
    return () => { socket.off('relay:fetch-for-dj', handleFetch); };
  }, [socket, enabled]);
}
