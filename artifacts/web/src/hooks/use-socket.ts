import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useUserSession } from './use-user-session';
import { useAuth } from './use-auth';

export interface RoomUser {
  socketId: string;
  userId?: number;
  username: string;
  displayName: string;
  isDJ: boolean;
  isAdmin: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  isCalling?: boolean;
}

export interface SyncState {
  playing: boolean;
  time: number;
  updatedAt: number;
  url: string | null;
  source: 'initial' | 'action' | 'heartbeat';
  /** True when the server knows the current stream is a live broadcast */
  isLive: boolean;
}

interface ChatMessageData {
  id: number;
  roomId: number;
  username: string;
  content: string;
  type: string;
  createdAt: string;
}

export function useSocket(slug: string | null) {
  const { username: sessionUsername, setUsername: setSessionUsername } = useUserSession();
  const { user: authUser } = useAuth();
  const username = authUser ? (authUser.displayName || authUser.username) : sessionUsername;
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [you, setYou] = useState<RoomUser | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({ playing: false, time: 0, updatedAt: Date.now(), url: null, source: 'initial', isLive: false });
  const [isLocked, setIsLocked] = useState(false);
  const [allowGuestControl, setAllowGuestControl] = useState(false);
  const [allowGuestEntry, setAllowGuestEntry] = useState(true);
  const [background, setBackground] = useState<string>('default');
  const [chatMessages, setChatMessages] = useState<ChatMessageData[]>([]);
  const [roomName, setRoomName] = useState<string>('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [chatDisabled, setChatDisabled] = useState(false);
  const [micDisabled, setMicDisabled] = useState(false);
  const [cameraDisabled, setCameraDisabled] = useState(false);
  const [subtitleSync, setSubtitleSync] = useState<{
    type: 'url' | 'content' | 'clear';
    url?: string;
    content?: string;
    label?: string;
    from: string;
  } | null>(null);

  useEffect(() => {
    if (authUser) {
      const profileName = authUser.displayName || authUser.username;
      if (profileName && profileName !== sessionUsername) {
        setSessionUsername(profileName);
      }
    }
  }, [authUser, sessionUsername, setSessionUsername]);

  useEffect(() => {
    if (!authUser?.id || !socketRef.current?.connected) return;
    socketRef.current.emit('identify', { userId: authUser.id });
  }, [authUser?.id]);

  useEffect(() => {
    if (!slug || !username) return;

    const socket = io('/', {
      path: '/api/socket.io',
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    const displayName = authUser?.displayName || authUser?.username || username;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-room', { slug, username, displayName, userId: authUser?.id });
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('kicked', () => {
      socket.disconnect();
      // Store banned room slug in localStorage so rooms-tab can show "مطرود"
      if (slug) {
        try {
          const banned: string[] = JSON.parse(localStorage.getItem('lrmtv_banned_rooms') || '[]');
          if (!banned.includes(slug)) banned.push(slug);
          localStorage.setItem('lrmtv_banned_rooms', JSON.stringify(banned));
          localStorage.setItem('lrmtv_last_kicked', slug);
        } catch {}
      }
      window.location.href = '/';
    });

    socket.on('room-deleted', () => {
      socket.disconnect();
      window.location.href = '/';
    });

    socket.on('room-frozen', () => {
      socket.disconnect();
      alert('هذه الغرفة مجمّدة مؤقتاً من قِبل الإدارة.');
      window.location.href = '/home';
    });

    socket.on('room-state', (state: {
      currentVideo: string | null;
      isPlaying: boolean;
      currentTime: number;
      isLocked: boolean;
      allowGuestControl: boolean;
      background: string;
      roomName?: string;
      users: RoomUser[];
      you: RoomUser;
      isLive?: boolean;
      serverTs?: number;
    }) => {
      setUsers(state.users || []);
      setYou(state.you);
      const latencyS = state.serverTs ? (Date.now() - state.serverTs) / 1000 : 0;
      setSyncState({
        playing: state.isPlaying,
        time: state.currentTime + (state.isPlaying ? latencyS : 0),
        updatedAt: Date.now(),
        url: state.currentVideo,
        source: 'initial',
        isLive: state.isLive ?? false,
      });
      setIsLocked(state.isLocked || false);
      setAllowGuestControl(state.allowGuestControl || false);
      if ((state as any).allowGuestEntry !== undefined) setAllowGuestEntry((state as any).allowGuestEntry);
      setBackground(state.background || 'default');
      if (state.roomName) setRoomName(state.roomName);
      if (state.isPrivate !== undefined) setIsPrivate(state.isPrivate);
      if (state.chatDisabled !== undefined) setChatDisabled(state.chatDisabled);
      if (state.micDisabled !== undefined) setMicDisabled(state.micDisabled);
      if (state.cameraDisabled !== undefined) setCameraDisabled(state.cameraDisabled);
      if ((state as any).subtitle) setSubtitleSync((state as any).subtitle);
    });

    socket.on('room-settings-updated', (data: { isPrivate: boolean; chatDisabled: boolean; micDisabled: boolean; cameraDisabled: boolean }) => {
      setIsPrivate(data.isPrivate);
      setChatDisabled(data.chatDisabled);
      setMicDisabled(data.micDisabled);
      setCameraDisabled(data.cameraDisabled);
    });

    socket.on('room-renamed', (data: { name: string }) => {
      setRoomName(data.name);
    });

    socket.on('user-joined', (data: {
      user: RoomUser;
      users: RoomUser[];
      systemMessage: { username: string; content: string; type: string; roomId: number };
    }) => {
      setUsers(data.users);
      if (data.systemMessage) {
        setChatMessages(prev => [...prev, {
          id: Date.now(),
          roomId: data.systemMessage.roomId,
          username: data.systemMessage.username,
          content: data.systemMessage.content,
          type: data.systemMessage.type,
          createdAt: new Date().toISOString(),
        }]);
      }
    });

    socket.on('user-left', (data: {
      socketId: string;
      username: string;
      users: RoomUser[];
      systemMessage: { username: string; content: string; type: string; roomId: number };
    }) => {
      setUsers(data.users);
      if (data.systemMessage) {
        setChatMessages(prev => [...prev, {
          id: Date.now(),
          roomId: data.systemMessage.roomId,
          username: data.systemMessage.username,
          content: data.systemMessage.content,
          type: data.systemMessage.type,
          createdAt: new Date().toISOString(),
        }]);
      }
    });

    socket.on('users-updated', (data: { users: RoomUser[] }) => {
      setUsers(data.users);
      // update `you` if our record changed
      setYou(prev => {
        if (!prev) return prev;
        return data.users.find(u => u.socketId === prev.socketId) ?? prev;
      });
    });

    socket.on('video-sync', (data: {
      action: string;
      currentTime: number;
      url: string | null;
      isPlaying: boolean;
      isLive?: boolean;
      from: string;
      serverTs?: number;
    }) => {
      const latencyS = data.serverTs ? (Date.now() - data.serverTs) / 1000 : 0;
      setSyncState(prev => ({
        playing: data.isPlaying,
        time: data.currentTime + (data.isPlaying ? latencyS : 0),
        updatedAt: Date.now(),
        url: data.url,
        source: 'action',
        isLive: data.isLive ?? prev.isLive,
      }));
    });

    // Periodic heartbeat — gentle drift correction only (big gaps, not small drifts)
    socket.on('heartbeat', (data: { currentTime: number; isPlaying: boolean; isLive?: boolean; serverTs?: number }) => {
      const latencyS = data.serverTs ? (Date.now() - data.serverTs) / 1000 : 0;
      setSyncState(prev => ({
        ...prev,
        time: data.currentTime + (data.isPlaying ? latencyS : 0),
        playing: data.isPlaying,
        isLive: data.isLive ?? prev.isLive,
        updatedAt: Date.now(),
        source: 'heartbeat',
      }));
    });

    socket.on('chat-message', (msg: ChatMessageData) => {
      setChatMessages(prev => [...prev, msg]);
    });

    socket.on('lock-changed', (data: { isLocked: boolean; allowGuestControl?: boolean }) => {
      setIsLocked(data.isLocked);
      if (data.allowGuestControl !== undefined) setAllowGuestControl(data.allowGuestControl);
    });

    socket.on('allow-guests-changed', (data: { allowGuestControl: boolean }) => {
      setAllowGuestControl(data.allowGuestControl);
      setIsLocked(!data.allowGuestControl);
    });

    socket.on('guest-entry-changed', (data: { allowGuestEntry: boolean }) => {
      setAllowGuestEntry(data.allowGuestEntry);
    });

    socket.on('guests-not-allowed', () => {
      socket.disconnect();
      window.location.href = '/';
    });

    socket.on('background-changed', (data: { background: string }) => {
      setBackground(data.background);
    });

    socket.on('subtitle-sync', (data: {
      type: 'url' | 'content' | 'clear';
      url?: string;
      content?: string;
      label?: string;
      from: string;
    }) => {
      setSubtitleSync(data.type === 'clear' ? null : data);
    });

    socket.on('playlist-update', () => {
      window.dispatchEvent(new CustomEvent('playlist-updated'));
    });

    // sync-rejected: server rejected our control action (not enough permission)
    socket.on('sync-rejected', (data: { reason: string }) => {
      console.warn('[sync] rejected:', data.reason);
    });

    socket.on('error', (data: { message: string }) => {
      console.error('Socket error:', data.message);
    });

    return () => {
      // Signal server before disconnecting so browser auto-pause is swallowed
      socket.emit('dj-backgrounding');
      socket.disconnect();
    };
  }, [slug, username]);

  const emitSync = useCallback((time: number, playing: boolean, url: string | null) => {
    if (!socketRef.current?.connected) return;
    if (url && url !== syncState.url) {
      socketRef.current.emit('video-sync', { action: 'change-video', currentTime: 0, url });
      setTimeout(() => {
        socketRef.current?.emit('video-sync', { action: playing ? 'play' : 'pause', currentTime: 0 });
      }, 100);
    } else if (playing) {
      socketRef.current.emit('video-sync', { action: 'play', currentTime: time });
    } else {
      socketRef.current.emit('video-sync', { action: 'pause', currentTime: time });
    }
  }, [syncState.url]);

  const emitSeek = useCallback((time: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('video-sync', { action: 'seek', currentTime: time });
    }
  }, []);

  const emitChatMessage = useCallback((content: string, type: 'message' | 'emoji' = 'message') => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('chat-message', { content, type });
    }
  }, []);

  const toggleLock = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('toggle-lock');
    }
  }, []);

  const toggleAllowGuests = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('toggle-allow-guests');
    }
  }, []);

  const toggleDJ = useCallback((targetSocketId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('grant-dj', { targetSocketId });
    }
  }, []);

  const changeBackground = useCallback((bg: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('change-background', { background: bg });
    }
  }, []);

  const emitWebRTCSignal = useCallback((targetSocketId: string, signal: unknown, type: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('webrtc-signal', { targetSocketId, signal, type });
    }
  }, []);

  const toggleMedia = useCallback((data: { isMuted?: boolean; isCameraOff?: boolean }) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('toggle-media', data);
    }
  }, []);

  const emitPlaylistUpdate = useCallback((action: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('playlist-update', { action });
    }
  }, []);

  const requestSync = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('request-sync');
    }
  }, []);

  const renameRoom = useCallback((name: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('rename-room', { name });
    }
  }, []);

  const togglePrivacy = useCallback(() => {
    if (socketRef.current?.connected) socketRef.current.emit('toggle-privacy');
  }, []);

  const toggleChat = useCallback(() => {
    if (socketRef.current?.connected) socketRef.current.emit('toggle-chat');
  }, []);

  const toggleMic = useCallback(() => {
    if (socketRef.current?.connected) socketRef.current.emit('toggle-mic');
  }, []);

  const toggleCamera = useCallback(() => {
    if (socketRef.current?.connected) socketRef.current.emit('toggle-camera');
  }, []);

  const toggleGuestEntry = useCallback(() => {
    if (socketRef.current?.connected) socketRef.current.emit('toggle-guest-entry');
  }, []);

  const kickUser = useCallback((targetSocketId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('kick-user', { targetSocketId });
    }
  }, []);

  const transferAdmin = useCallback((targetSocketId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('transfer-admin', { targetSocketId });
    }
  }, []);

  const emitSubtitleSync = useCallback((payload: {
    type: 'url' | 'content' | 'clear';
    url?: string;
    content?: string;
    label?: string;
    from: string;
  }) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('subtitle-sync', payload);
    }
  }, []);

  const emitStreamType = useCallback((isLive: boolean) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('stream-type', { isLive });
    }
  }, []);

  return {
    socket: socketRef.current,
    connected,
    users,
    you,
    syncState,
    isLocked,
    allowGuestControl,
    allowGuestEntry,
    background,
    roomName,
    chatMessages,
    isPrivate,
    chatDisabled,
    micDisabled,
    cameraDisabled,
    emitSync,
    emitSeek,
    emitChatMessage,
    toggleLock,
    toggleAllowGuests,
    toggleGuestEntry,
    toggleDJ,
    changeBackground,
    renameRoom,
    emitWebRTCSignal,
    toggleMedia,
    emitPlaylistUpdate,
    requestSync,
    kickUser,
    transferAdmin,
    togglePrivacy,
    toggleChat,
    toggleMic,
    toggleCamera,
    subtitleSync,
    emitSubtitleSync,
    emitStreamType,
  };
}
