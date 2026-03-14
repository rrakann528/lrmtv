import { useEffect, useRef, useCallback, useState } from 'react';
import { Socket } from 'socket.io-client';

interface PeerConnection {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  makingOffer: boolean;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useWebRTC(socket: Socket | null, localStream: MediaStream | null) {
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const updateRemoteStreams = useCallback(() => {
    const streams = new Map<string, MediaStream>();
    peersRef.current.forEach((peer, id) => {
      streams.set(id, peer.remoteStream);
    });
    setRemoteStreams(new Map(streams));
  }, []);

  const createPeerConnection = useCallback((targetSocketId: string, initiator: boolean) => {
    if (!socket) return null;

    if (peersRef.current.has(targetSocketId)) {
      peersRef.current.get(targetSocketId)!.pc.close();
      peersRef.current.delete(targetSocketId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    const remoteStream = new MediaStream();
    const peerObj: PeerConnection = { pc, remoteStream, makingOffer: false };

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    pc.ontrack = (event) => {
      if (!remoteStream.getTrackById(event.track.id)) {
        remoteStream.addTrack(event.track);
      }
      updateRemoteStreams();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-signal', {
          targetSocketId,
          signal: event.candidate,
          type: 'ice-candidate',
        });
      }
    };

    // Re-negotiate when a new track is added to an existing connection.
    // This fires automatically after addTrack() is called on a live connection.
    pc.onnegotiationneeded = async () => {
      if (peerObj.makingOffer) return;
      try {
        peerObj.makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        socket.emit('webrtc-signal', {
          targetSocketId,
          signal: pc.localDescription,
          type: 'offer',
        });
      } catch (err) {
        console.error('onnegotiationneeded error', err);
      } finally {
        peerObj.makingOffer = false;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === 'disconnected' ||
        pc.iceConnectionState === 'failed' ||
        pc.iceConnectionState === 'closed'
      ) {
        peersRef.current.delete(targetSocketId);
        updateRemoteStreams();
      }
    };

    peersRef.current.set(targetSocketId, peerObj);

    // For the initial connection the initiator creates the first offer.
    // Subsequent re-negotiations are handled by onnegotiationneeded above.
    if (initiator) {
      // onnegotiationneeded fires automatically after addTrack + setLocalDescription
      // but if there are no tracks yet we need to trigger an offer manually.
      if (!localStream || localStream.getTracks().length === 0) {
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit('webrtc-signal', {
              targetSocketId,
              signal: pc.localDescription,
              type: 'offer',
            });
          })
          .catch(console.error);
      }
      // When tracks exist, onnegotiationneeded fires automatically.
    }

    return pc;
  }, [socket, localStream, updateRemoteStreams]);

  const handleSignal = useCallback(async (data: {
    fromSocketId: string;
    signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
    type: string;
  }) => {
    const { fromSocketId, signal, type } = data;

    if (type === 'offer') {
      const existingPeer = peersRef.current.get(fromSocketId);

      if (existingPeer) {
        // ── Re-negotiation on an existing connection ──────────────────────────
        // Do NOT destroy the connection — just update the remote description.
        const { pc } = existingPeer;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signal as RTCSessionDescriptionInit));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket?.emit('webrtc-signal', {
            targetSocketId: fromSocketId,
            signal: pc.localDescription,
            type: 'answer',
          });
        } catch (err) {
          console.error('re-negotiation answer error', err);
        }
        return;
      }

      // ── New connection ────────────────────────────────────────────────────
      const pc = createPeerConnection(fromSocketId, false);
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal as RTCSessionDescriptionInit));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket?.emit('webrtc-signal', {
          targetSocketId: fromSocketId,
          signal: pc.localDescription,
          type: 'answer',
        });
      } catch (err) {
        console.error('new connection answer error', err);
      }

    } else if (type === 'answer') {
      const peer = peersRef.current.get(fromSocketId);
      if (peer) {
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(signal as RTCSessionDescriptionInit));
        } catch (err) {
          console.error('setRemoteDescription (answer) error', err);
        }
      }
    } else if (type === 'ice-candidate') {
      const peer = peersRef.current.get(fromSocketId);
      if (peer) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(signal as RTCIceCandidateInit));
        } catch (err) {
          // Non-fatal — can happen during rapid state changes
        }
      }
    }
  }, [createPeerConnection, socket]);

  useEffect(() => {
    if (!socket) return;
    socket.on('webrtc-signal', handleSignal);
    return () => { socket.off('webrtc-signal', handleSignal); };
  }, [socket, handleSignal]);

  const callPeer = useCallback((targetSocketId: string) => {
    createPeerConnection(targetSocketId, true);
  }, [createPeerConnection]);

  const callAllPeers = useCallback((userSocketIds: string[]) => {
    userSocketIds.forEach(id => createPeerConnection(id, true));
  }, [createPeerConnection]);

  const hangUp = useCallback(() => {
    peersRef.current.forEach((peer) => peer.pc.close());
    peersRef.current.clear();
    updateRemoteStreams();
  }, [updateRemoteStreams]);

  const replaceTrack = useCallback((newTrack: MediaStreamTrack) => {
    peersRef.current.forEach((peer) => {
      const sender = peer.pc.getSenders().find(s => s.track?.kind === newTrack.kind);
      if (sender) sender.replaceTrack(newTrack);
    });
  }, []);

  // When localStream changes (mic/cam toggled), update all existing connections.
  // addTrack triggers onnegotiationneeded automatically → re-negotiation happens.
  useEffect(() => {
    if (!localStream) return;
    peersRef.current.forEach((peer) => {
      const senders = peer.pc.getSenders();
      localStream.getTracks().forEach(track => {
        const existingSender = senders.find(s => s.track?.kind === track.kind);
        if (existingSender) {
          existingSender.replaceTrack(track);
        } else {
          peer.pc.addTrack(track, localStream);
          // onnegotiationneeded fires automatically after addTrack
        }
      });
    });
  }, [localStream]);

  useEffect(() => {
    return () => {
      peersRef.current.forEach((peer) => peer.pc.close());
      peersRef.current.clear();
    };
  }, []);

  return { remoteStreams, callPeer, callAllPeers, hangUp, replaceTrack };
}
