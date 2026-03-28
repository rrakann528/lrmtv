import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface DmMsg {
  id: number;
  senderId: number;
  receiverId: number;
  content: string;
  createdAt: string;
}

interface Options {
  userId: number | undefined;
  onFriendRequest?: () => void;
  onFriendAccepted?: (data: { byId: number; byName: string }) => void;
  onDmReceive?: (msg: DmMsg) => void;
}

export function useUserSocket({ userId, onFriendRequest, onFriendAccepted, onDmReceive }: Options) {
  const qc = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!userId) return;

    const token = localStorage.getItem('lrmtv_auth_token') || '';
    const socket = io(BASE || '/', {
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-user-room', { userId });
    });

    socket.on('friend-request', () => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['friends-badge'] });
      onFriendRequest?.();
    });

    socket.on('friend-accepted', (data: { byId: number; byName: string }) => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['friends-badge'] });
      onFriendAccepted?.(data);
    });

    socket.on('dm:receive', (msg: DmMsg) => {
      qc.invalidateQueries({ queryKey: ['friends-conversations'] });
      qc.invalidateQueries({ queryKey: ['friends-badge'] });
      if (msg?.senderId) qc.invalidateQueries({ queryKey: ['dm', msg.senderId] });
      if (msg?.receiverId) qc.invalidateQueries({ queryKey: ['dm', msg.receiverId] });
      onDmReceive?.(msg);
    });

    socket.on('group:message', (msg: { groupId?: number }) => {
      if (msg?.groupId) {
        qc.invalidateQueries({ queryKey: ['group-messages', msg.groupId] });
      }
    });

    socket.on('room-invite', () => {
      qc.invalidateQueries({ queryKey: ['room-invites'] });
      qc.invalidateQueries({ queryKey: ['rooms-badge'] });
    });

    socket.on('room-deleted', () => {
      qc.invalidateQueries({ queryKey: ['room-invites'] });
      qc.invalidateQueries({ queryKey: ['rooms-badge'] });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId]);

  return socketRef;
}
