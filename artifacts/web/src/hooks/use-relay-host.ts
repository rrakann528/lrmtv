import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';

export function useRelayHost(socket: Socket | null, enabled: boolean) {
  useEffect(() => {
    if (!socket || !enabled) return;

    const handleFetch = async (data: { requestId: string; url: string }) => {
      if (!data?.requestId || !data?.url) return;

      try {
        const res = await fetch(data.url, {
          headers: {
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          credentials: 'omit',
          cache: 'no-store',
        });

        if (!res.ok) {
          socket.emit('relay:error', { requestId: data.requestId, status: res.status });
          return;
        }

        const contentType = res.headers.get('content-type') || 'video/mp2t';
        const buffer = await res.arrayBuffer();
        socket.emit('relay:response', {
          requestId: data.requestId,
          data: buffer,
          contentType,
        });
      } catch {
        socket.emit('relay:error', { requestId: data.requestId, status: 502 });
      }
    };

    socket.on('relay:fetch', handleFetch);
    return () => { socket.off('relay:fetch', handleFetch); };
  }, [socket, enabled]);
}
