import Hls from 'hls.js';
import type { Socket } from 'socket.io-client';

let _socket: Socket | null = null;

export function setRelaySocket(s: Socket | null) {
  _socket = s;
}

function getSocket() {
  return _socket;
}

export function createRelayLoader() {
  const DefaultLoader = Hls.DefaultConfig.loader as new (...a: unknown[]) => unknown;

  return class RelayLoader extends (DefaultLoader as new (...a: unknown[]) => {
    load(ctx: unknown, cfg: unknown, cbs: unknown): void;
    abort(): void;
    destroy(): void;
  }) {
    private _aborted = false;
    private _cancelRelay: (() => void) | null = null;

    abort()   { this._aborted = true; this._cancelRelay?.(); super.abort(); }
    destroy() { this._aborted = true; this._cancelRelay?.(); super.destroy(); }

    load(
      context: Record<string, unknown>,
      config: unknown,
      callbacks: Record<string, (...args: unknown[]) => void>,
    ) {
      const socket = getSocket();

      if (!socket?.connected) {
        super.load(context, config, callbacks);
        return;
      }

      const url = context.url as string;
      const onErrCb = callbacks.onError as (
        e: { code: number; text: string }, ctx: unknown, r: unknown, s: unknown
      ) => void;

      const stats = {
        trequest: performance.now(), tfirst: 0, tload: 0,
        loaded: 0, total: 0, retry: 0, chunkCount: 0, bwEstimate: 0,
        loading: { start: performance.now(), first: 0, end: 0 },
        parsing:  { start: 0, end: 0 },
        buffering: { start: 0, first: 0, end: 0 },
      };

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const cleanup = () => {
        clearTimeout(timer);
        socket.off('relay:response', onResponse);
        socket.off('relay:error', onRelayError);
        this._cancelRelay = null;
      };

      const onResponse = (data: { requestId: string; data: unknown; contentType: string }) => {
        if (data.requestId !== requestId) return;
        cleanup();
        if (this._aborted) return;

        stats.tfirst = stats.tload = performance.now();
        stats.loading.first = stats.loading.end = stats.tload;

        try {
          const ctxType = (context.type as string) ?? '';
          const isText = ctxType === 'manifest' || ctxType === 'level' ||
            ctxType === 'audioTrack' || ctxType === 'subtitle' ||
            String(data.contentType ?? '').includes('mpegurl') ||
            String(data.contentType ?? '').includes('x-mpegurl');

          // Normalize to ArrayBuffer (Socket.IO may deliver as Buffer/Uint8Array)
          let rawBuf: ArrayBuffer;
          if (data.data instanceof ArrayBuffer) {
            rawBuf = data.data;
          } else if (ArrayBuffer.isView(data.data)) {
            rawBuf = (data.data as ArrayBufferView).buffer;
          } else {
            rawBuf = data.data as ArrayBuffer;
          }

          const payload = isText ? new TextDecoder('utf-8').decode(rawBuf) : rawBuf;
          stats.loaded = stats.total = isText
            ? (payload as string).length
            : rawBuf.byteLength;

          (callbacks.onSuccess as (r: unknown, s: unknown, c: unknown, n: null) => void)(
            { url, data: payload }, stats, context, null,
          );
        } catch {
          onErrCb({ code: 0, text: 'relay-loader parse error' }, context, null, stats);
        }
      };

      const onRelayError = (err: { requestId: string; status: number }) => {
        if (err.requestId !== requestId) return;
        cleanup();
        if (this._aborted) return;
        if (err.status === 503) {
          // 503 = server rejected relay because this client IS the host.
          // Fall back to direct HTTP load — the host's IP is accepted by the CDN.
          super.load(context, config, callbacks);
        } else {
          onErrCb({ code: err.status || 502, text: `relay error ${err.status}` }, context, null, stats);
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        if (!this._aborted) onErrCb({ code: 0, text: 'relay timeout' }, context, null, stats);
      }, 15_000);

      this._cancelRelay = cleanup;
      socket.on('relay:response', onResponse);
      socket.on('relay:error', onRelayError);
      socket.emit('relay:fetch', { requestId, url });
    }
  };
}
