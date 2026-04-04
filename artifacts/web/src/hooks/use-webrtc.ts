import { useEffect, useRef, useCallback, useState } from 'react';
import { Socket } from 'socket.io-client';

interface PeerConnection {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  makingOffer: boolean;
  // true for the very first offer from this PC (fresh connection).
  // Set to false after the first offer is sent so subsequent onnegotiationneeded
  // events (track additions) are treated as re-negotiations, not fresh connections.
  isFresh: boolean;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const VIDEO_MAX_BITRATE = 2_500_000; // 2.5 Mbps — enough for 1080p without killing DJ upload
const AUDIO_MAX_BITRATE = 128_000;   // 128 kbps

async function applyBitrateLimits(pc: RTCPeerConnection) {
  const senders = pc.getSenders();
  for (const sender of senders) {
    if (!sender.track) continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      if (sender.track.kind === 'video') {
        params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE;
        params.encodings[0].degradationPreference = 'maintain-framerate';
      } else if (sender.track.kind === 'audio') {
        params.encodings[0].maxBitrate = AUDIO_MAX_BITRATE;
      }
      await sender.setParameters(params);
    } catch {
      // setParameters may fail on some browsers — non-fatal
    }
  }
}

export function useWebRTC(socket: Socket | null, localStream: MediaStream | null, relayStream?: MediaStream | null) {
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Map<string, MediaStream>>(new Map());

  const updateRemoteStreams = useCallback(() => {
    const audioOnlyStreams = new Map<string, MediaStream>();
    const videoStreams = new Map<string, MediaStream>();
    peersRef.current.forEach((peer, id) => {
      const videoTracks = peer.remoteStream.getVideoTracks().filter(t => t.readyState === 'live');
      const audioTracks = peer.remoteStream.getAudioTracks().filter(t => t.readyState === 'live');
      const hasVideo = videoTracks.length > 0;
      const hasAudio = audioTracks.length > 0;
      if (hasVideo) {
        videoStreams.set(id, peer.remoteStream);
      } else if (hasAudio) {
        audioOnlyStreams.set(id, peer.remoteStream);
      }
    });
    setRemoteStreams(new Map(audioOnlyStreams));
    setRemoteVideoStreams(new Map(videoStreams));
  }, []);

  const createPeerConnection = useCallback((targetSocketId: string, initiator: boolean) => {
    if (!socket) return null;

    // Always close and replace any existing connection when actively initiating.
    // This guarantees both sides get a fresh PC with the current tracks.
    const existing = peersRef.current.get(targetSocketId);
    if (existing) {
      existing.pc.close();
      peersRef.current.delete(targetSocketId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    const remoteStream = new MediaStream();
    const peerObj: PeerConnection = { pc, remoteStream, makingOffer: false, isFresh: true };

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    if (relayStream) {
      relayStream.getTracks().forEach(track => {
        pc.addTrack(track, relayStream);
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

    // Fires when addTrack() is called on a live connection (re-negotiation).
    // Also fires for the initial offer when the PC has tracks and is created as initiator.
    pc.onnegotiationneeded = async () => {
      if (peerObj.makingOffer) return;
      try {
        peerObj.makingOffer = true;
        const fresh = peerObj.isFresh;
        peerObj.isFresh = false; // first offer sent — subsequent ones are re-negotiations
        await pc.setLocalDescription(await pc.createOffer());
        socket.emit('webrtc-signal', {
          targetSocketId,
          signal: pc.localDescription,
          type: 'offer',
          fresh, // tells receiver whether to create a fresh PC or re-negotiate
        });
        // Apply bitrate limits after offer is sent
        setTimeout(() => applyBitrateLimits(pc), 500);
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

    // Initiator with no tracks: manually trigger an offer so the connection is established
    // even before any media is added (e.g., camera-only → later add mic).
    // With tracks, onnegotiationneeded fires automatically.
    const totalTracks = (localStream?.getTracks().length ?? 0) + (relayStream?.getTracks().length ?? 0);
    if (initiator && totalTracks === 0) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          const fresh = peerObj.isFresh;
          peerObj.isFresh = false;
          socket.emit('webrtc-signal', {
            targetSocketId,
            signal: pc.localDescription,
            type: 'offer',
            fresh,
          });
        })
        .catch(console.error);
    }

    return pc;
  }, [socket, localStream, relayStream, updateRemoteStreams]);

  const handleSignal = useCallback(async (data: {
    fromSocketId: string;
    signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
    type: string;
    fresh?: boolean;
  }) => {
    const { fromSocketId, signal, type } = data;
    // Default to true if not specified (older clients / audio-only signals)
    const isFreshOffer = data.fresh !== false;

    if (type === 'offer') {
      const existingPeer = peersRef.current.get(fromSocketId);

      if (existingPeer && !isFreshOffer) {
        // ── Re-negotiation: peer added a new track to an existing connection ──
        // Keep the PC alive — just update the remote description and answer.
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
          setTimeout(() => applyBitrateLimits(pc), 500);
        } catch (err) {
          console.error('re-negotiation answer error', err);
        }
        return;
      }

      // ── Fresh connection: peer created a brand-new PC ─────────────────────
      // Close our stale PC (if any) and create a matching fresh one.
      // createPeerConnection will add our localStream tracks to the new PC,
      // so both sides get a fully functional bidirectional connection.
      if (existingPeer) {
        existingPeer.pc.close();
        peersRef.current.delete(fromSocketId);
      }

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
        setTimeout(() => applyBitrateLimits(pc), 500);
      } catch (err) {
        console.error('fresh connection answer error', err);
      }

    } else if (type === 'answer') {
      const peer = peersRef.current.get(fromSocketId);
      if (peer) {
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(signal as RTCSessionDescriptionInit));
          setTimeout(() => applyBitrateLimits(peer.pc), 500);
        } catch (err) {
          console.error('setRemoteDescription (answer) error', err);
        }
      }
    } else if (type === 'ice-candidate') {
      const peer = peersRef.current.get(fromSocketId);
      if (peer) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(signal as RTCIceCandidateInit));
        } catch {
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

  const removeVideoSenders = useCallback(() => {
    peersRef.current.forEach((peer) => {
      const videoSenders = peer.pc.getSenders().filter(s => s.track?.kind === 'video');
      videoSenders.forEach(sender => {
        peer.pc.removeTrack(sender);
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      peersRef.current.forEach((peer) => peer.pc.close());
      peersRef.current.clear();
    };
  }, []);

  return { remoteStreams, remoteVideoStreams, callPeer, callAllPeers, hangUp, replaceTrack, removeVideoSenders };
}
