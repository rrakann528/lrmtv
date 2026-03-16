import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { setPeerChannel } from '@/lib/p2p-loader';

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function usePeerViewer(socket: Socket | null, enabled: boolean) {
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    if (!socket || !enabled) return;

    const closePeer = () => {
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
      setPeerChannel(null);
    };

    socket.emit('p2p:join');

    const onOffer = async ({ hostSocketId, sdp }: { hostSocketId: string; sdp: RTCSessionDescriptionInit }) => {
      closePeer();
      const pc = new RTCPeerConnection({ iceServers: ICE });
      pcRef.current = pc;

      pc.ondatachannel = (e) => {
        const dc = e.channel;
        dc.binaryType = 'arraybuffer';
        dc.onopen  = () => setPeerChannel(dc);
        dc.onclose = () => setPeerChannel(null);
        dc.onerror = () => setPeerChannel(null);
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('p2p:ice', { targetSocketId: hostSocketId, candidate: e.candidate.toJSON() });
        }
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === 'disconnected' || s === 'failed') closePeer();
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('p2p:answer', { hostSocketId, sdp: pc.localDescription });
      } catch (err) {
        console.error('[P2P viewer] signaling error:', err);
        closePeer();
      }
    };

    const onIce = async ({ candidate }: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      if (!pcRef.current) return;
      try { await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    };

    socket.on('p2p:offer', onOffer);
    socket.on('p2p:ice', onIce);

    return () => {
      socket.off('p2p:offer', onOffer);
      socket.off('p2p:ice', onIce);
      socket.emit('p2p:leave');
      closePeer();
    };
  }, [socket, enabled]);
}
