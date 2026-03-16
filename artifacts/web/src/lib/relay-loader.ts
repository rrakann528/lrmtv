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
    private _relayCleanup: (() => void) | null = null;

    abort() {
      this._aborted = true;
      this._relayCleanup?.();
      super.abort();
    }

    destroy() {
      this._aborted = true;
      this._relayCleanup?.();
      super.destroy();
    }

    load(context: Record<string, unknown>, config: unknown, callbacks: Record<string, (...args: unknown[]) => void>) {
      const originalOnError = callbacks.onError as (
        err: { code: number; text: string },
        ctx: unknown,
        res: unknown,
        stats: unknown
      ) => void;

      const patchedCallbacks = {
        ...callbacks,
        onError: (
          error: { code: number; text: string },
          ctx: unknown,
          response: unknown,
          stats: unknown,
        ) => {
          const socket = getSocket();
          const isCorsOrBlocked = error.code === 0 || error.code === 403 || error.code === 502;

          if (!socket?.connected || !isCorsOrBlocked || this._aborted) {
            originalOnError(error, ctx, response, stats);
            return;
          }

          const url = context.url as string;
          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const cleanup = () => {
            socket.off('relay:response', onResponse);
            socket.off('relay:error', onRelayError);
            clearTimeout(timer);
          };

          const onResponse = (data: { requestId: string; data: ArrayBuffer; contentType: string }) => {
            if (data.requestId !== requestId) return;
            cleanup();
            if (this._aborted) return;
            try {
              (callbacks.onSuccess as (res: unknown, stats: unknown, ctx: unknown, nd: null) => void)(
                { url, data: data.data },
                stats,
                ctx,
                null,
              );
            } catch {
              originalOnError(error, ctx, response, stats);
            }
          };

          const onRelayError = (err: { requestId: string; status: number }) => {
            if (err.requestId !== requestId) return;
            cleanup();
            if (!this._aborted) originalOnError(error, ctx, response, stats);
          };

          const timer = setTimeout(() => {
            cleanup();
            if (!this._aborted) originalOnError(error, ctx, response, stats);
          }, 15_000);

          this._relayCleanup = cleanup;
          socket.on('relay:response', onResponse);
          socket.on('relay:error', onRelayError);
          socket.emit('relay:fetch', { requestId, url });
        },
      };

      super.load(context, config, patchedCallbacks);
    }
  };
}
