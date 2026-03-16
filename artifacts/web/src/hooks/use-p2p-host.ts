import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type Peer = { pc: RTCPeerConnection; dc: RTCDataChannel };

export function usePeerHost(socket: Socket | null, enabled: boolean) {
  const peers = useRef<Map<string, Peer>>(new Map());

  useEffect(() => {
    if (!socket || !enabled) return;

    async function openPeer(viewerSocketId: string) {
      const pc = new RTCPeerConnection({ iceServers: ICE });
      const dc = pc.createDataChannel('hls', { ordered: true });
      dc.binaryType = 'arraybuffer';
      peers.current.set(viewerSocketId, { pc, dc });

      dc.onmessage = async (e: MessageEvent) => {
        if (typeof e.data !== 'string') return;
        let msg: { requestId: string; url: string };
        try { msg = JSON.parse(e.data); } catch { return; }
        if (!msg.requestId || !msg.url) return;

        try {
          const res = await fetch(msg.url, {
            headers: { Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
            credentials: 'omit',
            cache: 'no-store',
          });
          if (!res.ok) {
            dc.send(JSON.stringify({ requestId: msg.requestId, error: res.status }));
            return;
          }
          const buf = await res.arrayBuffer();
          const rid = new TextEncoder().encode(msg.requestId);
          const out = new Uint8Array(36 + buf.byteLength);
          out.set(rid.slice(0, 36), 0);
          out.set(new Uint8Array(buf), 36);
          if (dc.readyState === 'open') dc.send(out.buffer);
        } catch {
          try { dc.send(JSON.stringify({ requestId: msg.requestId, error: 502 })); } catch {}
        }
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('p2p:ice', { targetSocketId: viewerSocketId, candidate: e.candidate.toJSON() });
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === 'disconnected' || s === 'failed' || s === 'closed') {
          pc.close();
          peers.current.delete(viewerSocketId);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('p2p:offer', { viewerSocketId, sdp: pc.localDescription });
    }

    const onViewerJoined = ({ viewerSocketId }: { viewerSocketId: string }) => {
      openPeer(viewerSocketId).catch(() => {});
    };

    const onAnswer = async ({ viewerSocketId, sdp }: { viewerSocketId: string; sdp: RTCSessionDescriptionInit }) => {
      const peer = peers.current.get(viewerSocketId);
      if (!peer) return;
      try { await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp)); } catch {}
    };

    const onIce = async ({ fromSocketId, candidate }: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      const peer = peers.current.get(fromSocketId);
      if (!peer) return;
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    };

    socket.on('p2p:viewer-joined', onViewerJoined);
    socket.on('p2p:answer', onAnswer);
    socket.on('p2p:ice', onIce);

    return () => {
      socket.off('p2p:viewer-joined', onViewerJoined);
      socket.off('p2p:answer', onAnswer);
      socket.off('p2p:ice', onIce);
      peers.current.forEach(({ pc }) => pc.close());
      peers.current.clear();
    };
  }, [socket, enabled]);
}
