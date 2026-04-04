import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRoute, useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, ListVideo, Users, UserPlus,
  Mic, MicOff, Copy, Share2, Shield,
  LogOut, LogIn, Settings2, Play, Radio,
} from 'lucide-react';

import { useI18n } from '@/lib/i18n';
import { useUserSession } from '@/hooks/use-user-session';
import { useSocket } from '@/hooks/use-socket';
import { useWebRTC } from '@/hooks/use-webrtc';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { useBackgroundAlive } from '@/hooks/use-background-alive';
import { useGetRoom, useAddPlaylistItem, getGetRoomPlaylistQueryKey } from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

import ChatPanel from './room/chat-panel';
import PlaylistPanel from './room/playlist-panel';
import UsersPanel from './room/users-panel';
import FriendsPanel from './room/friends-panel';
import { RoomSettingsSheet } from './room/room-settings-sheet';
import { UserProfileSheet } from '@/components/user-profile-sheet';
import { SmartPlayer, type SmartPlayerHandle, type RoomEventNotif } from '@/components/player/smart-player';
import { isFullscreenActive } from '@/lib/fullscreen';
import { detectVideoType } from '@/lib/detect-video-type';

import YoutubeSearch from '@/components/youtube-search';

function detectSourceType(url: string): 'youtube' | 'vimeo' | 'twitch' | 'mp4' | 'm3u8' | 'other' {
  const t = detectVideoType(url);
  if (t === 'youtube')  return 'youtube';
  if (t === 'vimeo')    return 'vimeo';
  if (t === 'twitch')   return 'twitch';
  if (t === 'hls')      return 'm3u8';
  if (t === 'html5')    return 'mp4';
  return 'other';
}


const TABS = [
  { id: 'chat',     Icon: MessageSquare, label: 'chat' },
  { id: 'playlist', Icon: ListVideo,     label: 'playlist' },
  { id: 'users',    Icon: Users,         label: 'users' },
  { id: 'friends',  Icon: UserPlus,      label: 'friends' },
] as const;

export default function RoomPage() {
  const [, params] = useRoute('/room/:slug');
  const slug = params?.slug || '';
  const [, navigate] = useLocation();

  const { t, lang } = useI18n();
  const { username: sessionUsername, setUsername } = useUserSession();
  const [nicknameInput, setNicknameInput] = useState('');

  const { data: room, isLoading: roomLoading } = useGetRoom(slug);

  const { user: authUser } = useAuth();
  const username = authUser ? (authUser.displayName || authUser.username) : sessionUsername;

  useEffect(() => {
    if (authUser) {
      const profileName = authUser.displayName || authUser.username;
      if (profileName && profileName !== sessionUsername) {
        setUsername(profileName);
      }
    }
  }, [authUser, sessionUsername, setUsername]);

  const {
    socket, users, you, syncState, isLocked, allowGuestControl, allowGuestEntry, background, roomName,
    chatMessages, isPrivate, chatDisabled, micDisabled, sponsorSkipEnabled,
    emitSync, emitSeek, emitChatMessage, emitDeleteMessage,
    toggleLock, toggleAllowGuests, toggleGuestEntry, toggleDJ, renameRoom, toggleMedia, emitPlaylistUpdate, requestSync,
    kickUser, transferAdmin, togglePrivacy, toggleChat, toggleMic, toggleSponsorSkip,
    subtitleSync, emitSubtitleSync, emitStreamType,
  } = useSocket(slug);

  const [activeTab, setActiveTab] = useState<'chat' | 'playlist' | 'users' | 'friends'>('chat');
  const [roomProfile, setRoomProfile] = useState<{ username: string; userId?: number } | null>(null);
  const [micOn, setMicOn]       = useState(false);
  const [bgImage, setBgImage]   = useState('');
  const [copied, setCopied]     = useState(false);
  const [isSeeking]             = useState(false);
  const [playerReady, setPlayerReady] = useState(false);

  const [watcherReadyState, setWatcherReadyState] = useState(true);
  const [localPlaying, setLocalPlaying] = useState(false);
  const prevVideoUrlRef = useRef<string | null>(null);
  const suppressPauseRef = useRef(false);

  // Room settings panel (admin only) — controlled from header button
  const [showRoomSettings, setShowRoomSettings] = useState(false);

  const [mediaConfirm, setMediaConfirm] = useState(false);

  const playerRef = useRef<SmartPlayerHandle>(null);
  const [isCurrentUsingProxy, setIsCurrentUsingProxy] = useState<boolean | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [relayStream, setRelayStream] = useState<MediaStream | null>(null);
  const [isRelaying, setIsRelaying] = useState(false);

  const { remoteStreams, remoteVideoStreams, callAllPeers, hangUp, removeVideoSenders } = useWebRTC(socket, localStream, relayStream);

  const isDJ       = you?.isDJ || you?.isAdmin || false;
  const isAdmin    = you?.isAdmin || false;
  const isGuest    = !you?.userId && !authUser?.id;
  const canControl = isDJ || allowGuestControl;
  const watcherReady = watcherReadyState;

  // ── Friends tab badge (unread DMs + groups) ──────────────────────────────
  const { data: dmBadge }    = useQuery<{ count: number }>({
    queryKey: ['friends-badge'],
    queryFn: () => apiFetch('/friends/badge').then(r => r.json()),
    enabled: !!authUser,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const { data: groupBadge } = useQuery<{ count: number }>({
    queryKey: ['groups-badge'],
    queryFn: () => apiFetch('/groups/badge').then(r => r.json()),
    enabled: !!authUser,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const friendsUnread = ((dmBadge?.count ?? 0) + (groupBadge?.count ?? 0)) > 0;

  // ── Fullscreen state (for room-event notifications) ──────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onNative  = () => setIsFullscreen(isFullscreenActive());
    const onSimEnter = () => setIsFullscreen(true);
    const onSimExit  = () => setIsFullscreen(false);
    document.addEventListener('fullscreenchange', onNative);
    document.addEventListener('webkitfullscreenchange', onNative);
    document.addEventListener('simulatedfullscreenenter', onSimEnter);
    document.addEventListener('simulatedfullscreenexit', onSimExit);
    return () => {
      document.removeEventListener('fullscreenchange', onNative);
      document.removeEventListener('webkitfullscreenchange', onNative);
      document.removeEventListener('simulatedfullscreenenter', onSimEnter);
      document.removeEventListener('simulatedfullscreenexit', onSimExit);
    };
  }, []);

  // ── Fast leave on PWA/tab close ──────────────────────────────────────────
  // `pagehide` fires when the page is truly being unloaded (PWA swipe-close,
  // tab close, navigation away). Emit leave-room immediately so the server
  // doesn't wait for the grace-period timer.
  useEffect(() => {
    if (!socket || !slug) return;
    const onPageHide = () => {
      socket.emit('leave-room', { slug });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [socket, slug]);

  // ── Room event notifications (shown in fullscreen overlay) ───────────────
  const [roomNotifs, setRoomNotifs] = useState<RoomEventNotif[]>([]);

  const addRoomNotif = React.useCallback((n: RoomEventNotif) => {
    setRoomNotifs(prev => [...prev, n]);
    setTimeout(() => setRoomNotifs(prev => prev.filter(x => x.id !== n.id)), 4000);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onJoined = (data: { user: { username: string }; users: unknown[] }) => {
      if (!isFullscreen) return;
      if (data.user.username === username) return;
      addRoomNotif({ id: `join-${Date.now()}`, username: data.user.username, type: 'join' });
    };
    const onLeft = (data: { username: string }) => {
      if (!isFullscreen) return;
      if (data.username === username) return;
      addRoomNotif({ id: `leave-${Date.now()}`, username: data.username, type: 'leave' });
    };
    socket.on('user-joined', onJoined);
    socket.on('user-left', onLeft);
    return () => {
      socket.off('user-joined', onJoined);
      socket.off('user-left', onLeft);
    };
  }, [socket, isFullscreen, username, addRoomNotif]);

  const hasVideo = !!syncState.url;
  const bgMediaInfo = React.useMemo(() => ({
    title: roomName || room?.name || 'LrmTV',
    artist: 'LrmTV',
  }), [roomName, room?.name]);

  const bgCallbacks = React.useMemo(() => ({
    onPlay: () => { if (canControl) emitSync(playerRef.current?.getCurrentTime() ?? syncState.time, true, syncState.url); },
    onPause: () => { if (canControl) emitSync(playerRef.current?.getCurrentTime() ?? syncState.time, false, syncState.url); },
    onSeekBackward: () => {
      if (!canControl) return;
      const t = playerRef.current?.getCurrentTime() ?? 0;
      playerRef.current?.seekTo(Math.max(0, t - 10));
      emitSeek(Math.max(0, t - 10));
    },
    onSeekForward: () => {
      if (!canControl) return;
      const t = playerRef.current?.getCurrentTime() ?? 0;
      playerRef.current?.seekTo(t + 10);
      emitSeek(t + 10);
    },
  }), [canControl, emitSync, emitSeek, syncState.time, syncState.url]);

  useBackgroundAlive(hasVideo, bgMediaInfo, bgCallbacks);

  // Tell the server when the DJ hides/closes so it can keep the room playing.
  // Also sets suppressPauseRef so the browser's auto-pause is NOT forwarded
  // to the server — eliminates the #1 cause of all-clients-seeking-to-0 on leave.
  useEffect(() => {
    if (!isDJ || !socket) return;
    const onHide = () => {
      socket.emit('dj-backgrounding');
      suppressPauseRef.current = true;
    };
    const onShow = () => {
      suppressPauseRef.current = false;
      // Resume local playback if the server still says we're playing.
      // The browser may have auto-paused the video when the tab was hidden
      // (common on mobile/PWA) — but the room state on the server stayed "playing".
      if (syncPlayingRef.current) {
        setTimeout(() => playerRef.current?.play(), 150);
      }
    };
    const onVisibility = () => { document.hidden ? onHide() : onShow(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    // Also catch window blur (e.g. switching apps on desktop) as extra safety
    window.addEventListener('blur', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('blur', onHide);
    };
  }, [isDJ, socket]);


  const queryClient = useQueryClient();
  const addMutation = useAddPlaylistItem();
  const { toast } = useToast();

  const [deleteError, setDeleteError] = useState('');
  const handleDeleteRoom = useCallback(async () => {
    try {
      const res = await apiFetch(`/rooms/${slug}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDeleteError(err.error || 'Failed to delete room');
        setTimeout(() => setDeleteError(''), 5000);
        return;
      }
      navigate('/');
    } catch {
      setDeleteError('Failed to delete room');
      setTimeout(() => setDeleteError(''), 5000);
    }
  }, [slug, navigate]);

  const handleAddVideo = useCallback(async (url: string, title: string) => {
    if (!url.trim()) return;
    const sourceType = detectSourceType(url);
    const displayTitle = title && title !== url ? title : `Video (${sourceType})`;
    try {
      await addMutation.mutateAsync({ slug, data: { url, title: displayTitle, sourceType } });
      queryClient.invalidateQueries({ queryKey: getGetRoomPlaylistQueryKey(slug) });
      emitPlaylistUpdate('add');
      if (!syncState.url) emitSync(0, false, url);
    } catch (err: unknown) {
      console.error('[handleAddVideo] failed:', { url, sourceType, err });
      toast({ title: 'فشل إضافة الفيديو', description: String(err), variant: 'destructive', duration: 4000 });
    }
  }, [slug, addMutation, queryClient, emitPlaylistUpdate, syncState.url, emitSync, toast]);

  const handleSniffAddVideo = useCallback(async (url: string, title: string) => {
    if (!url.trim()) return;
    const sourceType = detectSourceType(url);
    const displayTitle = title && title !== url ? title : `Video (${sourceType})`;
    try {
      await addMutation.mutateAsync({ slug, data: { url, title: displayTitle, sourceType } });
      queryClient.invalidateQueries({ queryKey: getGetRoomPlaylistQueryKey(slug) });
      emitPlaylistUpdate('add');
      emitSync(0, true, url);
    } catch (err: unknown) {
      console.error('[handleSniffAddVideo] failed:', { url, sourceType, err });
      toast({ title: 'فشل إضافة الفيديو', description: String(err), variant: 'destructive', duration: 4000 });
    }
  }, [slug, addMutation, queryClient, emitPlaylistUpdate, emitSync, toast]);

  // ── Auto-load a video URL shared via the PWA Share Target ─────────────────
  // When the user tapped "شاهد في غرفة" from the home share banner, we stored
  // the video URL in sessionStorage.  Once the DJ is confirmed by the server
  // (isDJ=true) and the room has no active video, auto-add it to the playlist
  // and start playing — exactly as if the DJ had pasted the URL manually.
  const sharedVideoConsumedRef = useRef(false);
  useEffect(() => {
    if (!isDJ || syncState.url || sharedVideoConsumedRef.current) return;
    try {
      const shared = sessionStorage.getItem('lrmtv_shared_video_url');
      if (!shared) return;
      sessionStorage.removeItem('lrmtv_shared_video_url');
      sharedVideoConsumedRef.current = true;
      handleAddVideo(shared, shared);
    } catch { /* ignore */ }
  }, [isDJ, syncState.url, handleAddVideo]);

  useEffect(() => {
    setBgImage(
      background && background !== 'default'
        ? background
        : `${import.meta.env.BASE_URL}images/lounge-1.png`,
    );
  }, [background]);

  const isRemoteSeekRef = useRef(false);
  // Timestamp of when the player last became ready — used to enforce a grace period
  // so the sync effect doesn't issue a seek immediately after the initial buffer load.
  const readyTimeRef = useRef<number>(0);
  // Ref mirror of syncState.playing so closures (event handlers) always see the latest value.
  const syncPlayingRef = useRef(syncState.playing);
  useEffect(() => { syncPlayingRef.current = syncState.playing; }, [syncState.playing]);

  // Reset optimistic localPlaying once the server confirms the playing state.
  useEffect(() => { if (syncState.playing) setLocalPlaying(false); }, [syncState.playing]);

  // Keep a ref of isDJ so the URL-change effect can read it without adding it to deps.
  const isDJRef = useRef(isDJ);
  useEffect(() => { isDJRef.current = isDJ; }, [isDJ]);

  useEffect(() => {
    if (syncState.url !== prevVideoUrlRef.current) {
      prevVideoUrlRef.current = syncState.url;
      setPlayerReady(false);
      readyTimeRef.current = 0;
      if (isRelaying) {
        relayStream?.getTracks().forEach(t => t.stop());
        setRelayStream(null);
        setIsRelaying(false);
      }
    }
  }, [syncState.url]);

  useEffect(() => {
    if (!playerRef.current || isSeeking || !playerReady || !watcherReady) return;
    if (syncState.isLive) return;

    const playerTime = playerRef.current.getCurrentTime() || 0;
    const diff = Math.abs(playerTime - syncState.time);
    const sinceReady = Date.now() - readyTimeRef.current;

    const threshold = syncState.source === 'action'    ? 0.8
                    : syncState.source === 'heartbeat' ? 2.0
                    : sinceReady > 5_000               ? 2.0
                    : Infinity;

    if (diff > threshold) {
      if (syncState.source === 'heartbeat') {
        const videoEl = playerRef.current.getVideoElement?.();
        if (videoEl && videoEl.readyState < 3) return;
      }
      isRemoteSeekRef.current = true;
      playerRef.current.seekTo(syncState.time, 'seconds');
      setTimeout(() => { isRemoteSeekRef.current = false; }, 400);
      // After a seek the browser may leave the video in a paused/waiting state even
      // though playing=true — especially for proxied streams that need time to buffer
      // the new position.  Force play() once the seek flag clears so the video
      // resumes as soon as data is available.
      if (syncState.playing) {
        setTimeout(() => {
          if (syncPlayingRef.current) playerRef.current?.play();
        }, 500);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncState.time, syncState.playing, syncState.source, syncState.isLive, isSeeking, playerReady, watcherReady]);

  const doEnableMic = useCallback(async () => {
    setMicOn(true);
    toggleMedia({ isMuted: false });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
    } catch {
      setMicOn(false);
      toggleMedia({ isMuted: true });
    }
  }, [toggleMedia]);

  const handleToggleMic = useCallback(async () => {
    if (!micOn) {
      setMediaConfirm(true);
      return;
    }
    setMicOn(false);
    toggleMedia({ isMuted: true });
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.stop());
      setLocalStream(null);
      hangUp();
    }
  }, [micOn, toggleMedia, localStream, hangUp]);

  const handleConfirmMedia = useCallback(async () => {
    setMediaConfirm(false);
    await doEnableMic();
  }, [doEnableMic]);

  const handleToggleRelay = useCallback(() => {
    if (isRelaying) {
      removeVideoSenders();
      if (relayStream) {
        relayStream.getTracks().forEach(t => t.stop());
        setRelayStream(null);
      }
      setIsRelaying(false);
      socket?.emit('relay-mode', { active: false });
    } else {
      const stream = playerRef.current?.captureStream();
      if (stream && stream.getTracks().length > 0) {
        setRelayStream(stream);
        setIsRelaying(true);
        socket?.emit('relay-mode', { active: true });
      }
    }
  }, [isRelaying, relayStream, socket, removeVideoSenders]);

  useEffect(() => {
    if (!relayStream || !isRelaying) return;
    const others = users.filter(u => u.socketId !== you?.socketId).map(u => u.socketId);
    if (others.length > 0) {
      const timer = setTimeout(() => callAllPeers(others), 200);
      return () => clearTimeout(timer);
    }
  }, [relayStream, isRelaying, users, you, callAllPeers]);

  useEffect(() => {
    if (localStream && users.length > 1) {
      const others = users.filter(u => u.socketId !== you?.socketId).map(u => u.socketId);
      if (others.length > 0) callAllPeers(others);
    }
  }, [localStream, users, you, callAllPeers]);

  useEffect(() => () => { localStream?.getTracks().forEach(t => t.stop()); }, [localStream]);
  useEffect(() => () => { relayStream?.getTracks().forEach(t => t.stop()); }, [relayStream]);

  useEffect(() => {
    if (micDisabled && micOn) { setMicOn(false); toggleMedia({ isMuted: true }); }
  }, [micDisabled]);

  const handlePlay  = () => {
    if (!canControl) return;
    // DJ returned / resumed — allow future pause events again
    suppressPauseRef.current = false;
    emitSync(playerRef.current?.getCurrentTime() || syncState.time, true, syncState.url);
  };
  // Use syncState.time as fallback so we never send currentTime=0 when the player
  // ref is null (tab close) — also guarded by suppressPauseRef so the browser's
  // auto-pause on tab-hide / pagehide is never forwarded to the server.
  const handlePause = () => {
    // Suppress the pause if:
    // 1. DJ is backgrounding (suppressed by our own code), OR
    // 2. The document is hidden — the browser auto-paused when the tab was hidden.
    //    We never want to forward that to the server.
    if (!canControl || suppressPauseRef.current || document.hidden) return;
    emitSync(playerRef.current?.getCurrentTime() || syncState.time, false, syncState.url);
  };
  const handleSeek  = (s: number) => {
    if (isRemoteSeekRef.current || !canControl) return;
    // For live streams: don't broadcast seek to 0 — it means the player
    // failed to seek and fell back to the start, which would break everyone's sync.
    if (syncState.isLive && s < 1) return;
    emitSeek(s);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (roomLoading) return <div className="h-dvh bg-background flex items-center justify-center text-white">{t('loading')}</div>;
  if (!room)       return <div className="h-dvh bg-background flex items-center justify-center text-white">{t('roomNotFound')}</div>;

  if (!username && !authUser) {
    return (
      <div className="h-dvh bg-background flex items-center justify-center p-4">
        <div className="glass-panel rounded-2xl p-8 w-full max-w-sm space-y-4">
          <h2 className="text-xl font-bold text-white text-center">{t('enterNickname')}</h2>
          <form onSubmit={(e) => { e.preventDefault(); if (nicknameInput.trim()) setUsername(nicknameInput.trim()); }}>
            <input
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              placeholder={t('yourNickname')}
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/40 outline-none focus:border-cyan-400 transition mb-4"
              autoFocus
            />
            <Button type="submit" className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold py-3" disabled={!nicknameInput.trim()}>
              {t('join')}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden"
      style={{ backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm z-0" />

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="relative z-10 shrink-0 h-10 md:h-14 glass-panel border-x-0 border-t-0 flex items-center justify-between px-2 md:px-6">
        {/* Right (first in RTL): controls */}
        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          {/* Leave */}
          <button
            onClick={() => { suppressPauseRef.current = true; window.location.href = '/'; }}
            className="h-8 px-2 md:px-3 flex items-center gap-1.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-xs font-medium transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t('leave')}</span>
          </button>

          {/* Share */}
          <button
            onClick={copyUrl}
            className="h-8 px-2 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-colors text-xs"
          >
            {copied ? <Copy className="w-3.5 h-3.5 text-green-400" /> : <Share2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? t('copied') : t('copyLink')}</span>
          </button>

          {/* Room Settings — admin only */}
          {isAdmin && (
            <button
              onClick={() => setShowRoomSettings(s => !s)}
              title={t('roomSettings')}
              className={cn(
                'h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 transition-colors',
                showRoomSettings
                  ? 'bg-primary/20 border-primary/40 text-primary'
                  : 'bg-white/5 text-white/70 hover:text-white hover:bg-white/10',
              )}
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}

          {/* Mic */}
          <button
            onClick={handleToggleMic}
            disabled={micDisabled || isGuest}
            title={isGuest ? t('signInToUseMic') : micDisabled ? t('micDisabledByHost') : undefined}
            className={cn('h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 transition-colors',
              (micDisabled || isGuest) ? 'opacity-40 cursor-not-allowed text-white/40'
              : micOn ? 'bg-primary/20 text-primary' : 'text-white/70 hover:text-white hover:bg-white/10')}
          >
            {micOn && !micDisabled && !isGuest ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4 text-red-400" />}
          </button>

          {/* Relay (DJ only) */}
          {isDJ && syncState.url && (
            <button
              onClick={handleToggleRelay}
              title={isRelaying ? 'إيقاف البث المباشر' : 'بث مباشر للمشاهدين'}
              className={cn('h-8 px-2 flex items-center gap-1.5 rounded-lg border border-white/10 transition-colors text-xs font-medium',
                isRelaying
                  ? 'bg-red-500/20 border-red-500/40 text-red-400 animate-pulse'
                  : 'bg-white/5 text-white/70 hover:text-white hover:bg-white/10')}
            >
              <Radio className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isRelaying ? 'بث مباشر' : 'بث'}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <h1 className="text-sm md:text-base font-display font-bold text-glow truncate max-w-[130px] sm:max-w-xs md:max-w-md">
              {roomName || room.name}
            </h1>
            {syncState.url && (
              <p className="text-[10px] text-white/50 truncate max-w-[130px] sm:max-w-xs md:max-w-md hidden sm:block">
                {t('nowPlaying')}: {(() => {
                  try {
                    const u = new URL(syncState.url);
                    if (u.hostname.includes('youtube')) return 'YouTube';
                    if (u.hostname.includes('twitch')) return 'Twitch';
                    if (u.hostname.includes('vimeo')) return 'Vimeo';
                    return u.hostname.replace('www.', '');
                  } catch { return 'Stream'; }
                })()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/70">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              {users.length}
            </span>
            {(() => {
              const admin = users.find(u => u.isAdmin);
              return admin ? (
                <span className="hidden md:flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
                  <Shield className="w-3 h-3" />
                  {admin.displayName || admin.username}
                </span>
              ) : null;
            })()}
          </div>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <main className="relative z-10 flex-grow flex flex-col md:flex-row overflow-hidden min-h-0">

        {/* ── Player column ───────────────────────────────────────── */}
        <div className="flex flex-col min-h-0 md:flex-grow">

          {/* Player area:
              mobile  → fixed 16:9 aspect ratio
              md+     → flex-grow (fills all available height) */}
          <div className="w-full aspect-[2/1] md:aspect-auto md:flex-grow relative bg-black shrink-0 overflow-hidden">
            {syncState.url ? (
              <>
                <div style={{ position: 'absolute', inset: 0 }}>
                <SmartPlayer
                  ref={playerRef}
                  url={syncState.url}
                  playing={(syncState.playing || localPlaying) && watcherReady}
                  controls={canControl && watcherReady}
                  canControl={canControl && watcherReady}
                  initialTime={syncState.time}
                  isLiveHint={syncState.isLive}
                  onIsLive={emitStreamType}
                  onUrlResolved={(_url, proxy) => setIsCurrentUsingProxy(proxy)}
                  onReady={() => { readyTimeRef.current = Date.now(); setPlayerReady(true); }}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onSeek={handleSeek}
                  chatMessages={chatMessages}
                  username={username}
                  onSendChatMessage={emitChatMessage}
                  onFocusChat={() => setActiveTab('chat')}
                  lang={lang as 'en' | 'ar'}
                  onSubtitleApplied={emitSubtitleSync}
                  externalSubtitle={subtitleSync}
                  sponsorSkipEnabled={sponsorSkipEnabled}
                  roomNotifications={roomNotifs}
                />
                </div>

              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40 gap-3">
                <ListVideo className="w-12 h-12 opacity-30" />
                <p className="text-sm">{t('nothingPlaying')}</p>
              </div>
            )}

            {/* Locked badge */}
            {isLocked && !isDJ && (
              <div className="absolute top-2 end-2 bg-black/60 backdrop-blur px-2.5 py-1 rounded-full flex items-center gap-1.5 text-[11px] font-semibold text-white/80 z-10">
                <Shield className="w-3 h-3 text-red-400" />
                {t('playerLocked')}
              </div>
            )}

            {/* Relay video from DJ (WebRTC) — inside player container */}
            {!isDJ && remoteVideoStreams.size > 0 && (() => {
              const entries = Array.from(remoteVideoStreams.entries());
              const [, videoStream] = entries[0];
              const hasActiveTracks = videoStream.getVideoTracks().some(t => t.readyState === 'live');
              if (!hasActiveTracks) return null;
              return (
                <div className="absolute inset-0 z-20 bg-black">
                  <video
                    autoPlay
                    playsInline
                    muted={false}
                    ref={el => { if (el && el.srcObject !== videoStream) el.srcObject = videoStream; }}
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-2 start-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/80 backdrop-blur text-white text-[11px] font-bold z-10">
                    <Radio className="w-3 h-3 animate-pulse" />
                    بث مباشر
                  </div>
                </div>
              );
            })()}

          </div>

          {/* Audio-only remote streams */}
          {Array.from(remoteStreams.entries()).map(([socketId, stream]) => (
            <audio key={socketId} autoPlay playsInline ref={el => { if (el) el.srcObject = stream; }} style={{ display: 'none' }} />
          ))}
        </div>

        {/* ── Chat / Playlist / Users panel ───────────────────────── */}
        <div className={cn(
          'flex flex-col min-h-0 bg-black/40',
          // Mobile: fills remaining space below player
          'flex-grow',
          // md+: fixed-width sidebar with left border
          'md:flex-grow-0 md:w-72 lg:w-96 md:shrink-0 md:border-s border-white/10',
        )}>

          {/* ── YouTube search + direct URL — only for users with control ── */}
          {canControl && (
            <div className="shrink-0 px-2 py-1.5 md:px-3 md:py-2.5 border-b border-white/10">
              <YoutubeSearch
                onAdd={handleAddVideo}
                onSniffAdd={handleSniffAddVideo}
                isAdding={addMutation.isPending}
                lang={lang}
                isDj={isDJ}
                roomSlug={slug}
              />
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-white/10 shrink-0">
            {TABS.map(({ id, Icon, label }) => {
              const hasChatAlert    = id === 'chat'    && chatDisabled;
              const hasMediaAlert   = id === 'users'   && micDisabled;
              const hasFriendsAlert = id === 'friends' && friendsUnread && activeTab !== 'friends';
              const hasAlert = hasChatAlert || hasMediaAlert;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 md:py-2 text-[10px] md:text-xs font-medium transition-colors border-b-2 relative',
                    activeTab === id
                      ? 'border-primary text-primary bg-white/5'
                      : 'border-transparent text-white/50 hover:text-white hover:bg-white/5',
                  )}
                >
                  <span className="relative">
                    <Icon className="w-4 h-4" />
                    {hasAlert && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-black/80" />
                    )}
                    {hasFriendsAlert && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full border border-black/80 animate-pulse" />
                    )}
                  </span>
                  {t(label as Parameters<typeof t>[0])}
                </button>
              );
            })}
          </div>

          {/* Panel content */}
          <div className="flex-grow overflow-hidden relative min-h-0">
            <AnimatePresence mode="wait">
              {activeTab === 'chat' && (
                <ChatPanel
                  key="chat"
                  slug={slug}
                  emitChatMessage={emitChatMessage}
                  emitDeleteMessage={emitDeleteMessage}
                  username={username}
                  liveMessages={chatMessages}
                  chatDisabled={chatDisabled}
                  isAdmin={isAdmin}
                  isGuest={isGuest}
                  users={users}
                />
              )}
              {activeTab === 'playlist' && (
                <PlaylistPanel
                  key="playlist"
                  slug={slug}
                  isDJ={isDJ}
                  canControl={canControl}
                  currentUrl={syncState.url}
                  isPlaying={syncState.playing}
                  isCurrentUsingProxy={isCurrentUsingProxy}
                  emitSync={emitSync}
                  emitPlaylistUpdate={emitPlaylistUpdate}
                />
              )}
              {activeTab === 'users' && (
                <UsersPanel
                  key="users"
                  users={users}
                  you={you}
                  isAdmin={isAdmin}
                  allowGuestControl={allowGuestControl}
                  micDisabled={micDisabled}
                  toggleDJ={toggleDJ}
                  kickUser={kickUser}
                  transferAdmin={transferAdmin}
                  requestSync={requestSync}
                  onUserClick={(username, userId) => setRoomProfile({ username, userId })}
                />
              )}
              {activeTab === 'friends' && (
                authUser
                  ? <FriendsPanel
                      key="friends"
                      userId={authUser.id}
                      roomSlug={slug}
                      roomName={room?.name || slug}
                      socket={socket}
                      roomUsers={users}
                      myUsername={username}
                    />
                  : <div key="friends-login" className="flex flex-col items-center justify-center h-full gap-4 p-6">
                      <UserPlus className="w-12 h-12 text-white/10" />
                      <p className="text-white/40 text-sm text-center">سجّل دخولك لإضافة أصدقاء ودعوتهم</p>
                      <a
                        href={`${import.meta.env.BASE_URL}auth`.replace('//', '/')}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-black font-semibold text-sm"
                      >
                        <LogIn className="w-4 h-4" /> تسجيل الدخول
                      </a>
                    </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* User Profile Sheet (from room) */}
      <AnimatePresence>
        {roomProfile && (
          <UserProfileSheet
            userId={roomProfile.userId}
            username={roomProfile.username}
            onClose={() => setRoomProfile(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Room Settings Sheet ──────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showRoomSettings && isAdmin && (
            <RoomSettingsSheet
              isAdmin={isAdmin}
              allowGuestControl={allowGuestControl}
              allowGuestEntry={allowGuestEntry}
              isPrivate={isPrivate}
              chatDisabled={chatDisabled}
              micDisabled={micDisabled}
              sponsorSkipEnabled={sponsorSkipEnabled}
              toggleAllowGuests={toggleAllowGuests}
              toggleGuestEntry={toggleGuestEntry}
              togglePrivacy={togglePrivacy}
              toggleChat={toggleChat}
              toggleMic={toggleMic}
              toggleSponsorSkip={toggleSponsorSkip}
              currentRoomName={roomName || room.name}
              renameRoom={renameRoom}
              deleteRoom={isAdmin ? handleDeleteRoom : undefined}
              onClose={() => setShowRoomSettings(false)}
            />
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Media Confirmation Dialog ────────────────────────────────── */}
      {mediaConfirm && createPortal(
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMediaConfirm(false)} />
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="relative w-full max-w-sm mx-4 mb-8 sm:mb-0 rounded-2xl overflow-hidden"
            style={{ background: 'rgba(18,18,20,0.97)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <div className="flex flex-col items-center gap-3 pt-8 pb-2 px-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-cyan-500/15">
                <Mic className="w-8 h-8 text-cyan-400" />
              </div>
              <h3 className="text-white font-bold text-lg text-center">فتح المايكروفون؟</h3>
              <p className="text-white/50 text-sm text-center leading-relaxed">
                سيتمكن المشاركون في الغرفة من سماعك. هل تريد المتابعة؟
              </p>
            </div>
            <div className="flex gap-2 p-4 pt-3">
              <button
                onClick={() => setMediaConfirm(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmMedia}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-black bg-cyan-400 hover:bg-cyan-300 transition"
              >
                نعم، افتح المايك
              </button>
            </div>
            <div style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} />
          </motion.div>
        </div>,
        document.body
      )}
      {deleteError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm animate-in fade-in">
          {deleteError}
        </div>
      )}
    </div>
  );
}
