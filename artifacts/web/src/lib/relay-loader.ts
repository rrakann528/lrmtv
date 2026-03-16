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
    private _requestId: string | null = null;
    private _timer: ReturnType<typeof setTimeout> | null = null;

    private _clear(socket: Socket | null, onResp: (d: unknown) => void, onErr: (d: unknown) => void) {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (socket) { socket.off('relay:response', onResp); socket.off('relay:error', onErr); }
      this._requestId = null;
    }

    abort()   { this._aborted = true; this._cleanup(); super.abort(); }
    destroy() { this._aborted = true; this._cleanup(); super.destroy(); }

    private _cleanup() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this._requestId = null;
    }

    load(
      context: Record<string, unknown>,
      config: unknown,
      callbacks: Record<string, (...args: unknown[]) => void>,
    ) {
      const socket = getSocket();

      // No socket → fall back to default loader (no relay available)
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
        loading: { start: 0, first: 0, end: 0 },
        parsing:  { start: 0, end: 0 },
        buffering: { start: 0, first: 0, end: 0 },
      };

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this._requestId = requestId;

      const onResponse = (data: { requestId: string; data: ArrayBuffer; contentType: string }) => {
        if (data.requestId !== requestId) return;
        this._clear(socket, onResponse, onRelayError);
        if (this._aborted) return;

        stats.tfirst = stats.tload = performance.now();
        try {
          // HLS.js needs a string for manifests/playlists and ArrayBuffer for media segments
          const ctxType = (context.type as string) ?? '';
          const isText = ctxType === 'manifest' || ctxType === 'level' ||
            ctxType === 'audioTrack' || ctxType === 'subtitle' ||
            String(data.contentType ?? '').includes('mpegurl') ||
            String(data.contentType ?? '').includes('x-mpegurl');

          const rawBuf = data.data instanceof ArrayBuffer
            ? data.data
            : (data.data as unknown as { buffer: ArrayBuffer }).buffer ?? data.data;

          const payload = isText ? new TextDecoder('utf-8').decode(rawBuf) : rawBuf;
          stats.loaded = stats.total = isText
            ? (payload as string).length
            : (rawBuf as ArrayBuffer).byteLength;

          (callbacks.onSuccess as (r: unknown, s: unknown, c: unknown, n: null) => void)(
            { url, data: payload }, stats, context, null,
          );
        } catch {
          onErrCb({ code: 0, text: 'relay-loader parse error' }, context, null, stats);
        }
      };

      const onRelayError = (err: { requestId: string; status: number }) => {
        if (err.requestId !== requestId) return;
        this._clear(socket, onResponse, onRelayError);
        if (!this._aborted) onErrCb({ code: err.status || 502, text: `relay error ${err.status}` }, context, null, stats);
      };

      this._timer = setTimeout(() => {
        this._clear(socket, onResponse, onRelayError);
        if (!this._aborted) onErrCb({ code: 0, text: 'relay timeout' }, context, null, stats);
      }, 15_000);

      socket.on('relay:response', onResponse);
      socket.on('relay:error', onRelayError);
      socket.emit('relay:fetch', { requestId, url });
    }
  };
}
