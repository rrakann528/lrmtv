import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRoute, useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, ListVideo, Users, UserPlus,
  Mic, MicOff, Video, VideoOff, Copy, Share2, Shield,
  LogOut, LogIn, Settings2,
} from 'lucide-react';
import { DraggableCam } from '@/components/draggable-cam';

import { useI18n } from '@/lib/i18n';
import { useUserSession } from '@/hooks/use-user-session';
import { useSocket } from '@/hooks/use-socket';
import { useWebRTC } from '@/hooks/use-webrtc';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { useGetRoom, useAddPlaylistItem, getGetRoomPlaylistQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import ChatPanel from './room/chat-panel';
import PlaylistPanel from './room/playlist-panel';
import UsersPanel from './room/users-panel';
import FriendsPanel from './room/friends-panel';
import { RoomSettingsSheet } from './room/room-settings-sheet';
import { UserProfileSheet } from '@/components/user-profile-sheet';
import { SmartPlayer, type SmartPlayerHandle } from '@/components/player/smart-player';
import YoutubeSearch from '@/components/youtube-search';

function detectSourceType(url: string): 'youtube' | 'vimeo' | 'twitch' | 'mp4' | 'm3u8' | 'other' {
  if (url.includes('youtube') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('twitch')) return 'twitch';
  if (url.includes('vimeo')) return 'vimeo';
  if (url.endsWith('.mp4')) return 'mp4';
  if (url.endsWith('.m3u8')) return 'm3u8';
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
  const { username, setUsername } = useUserSession();
  const [nicknameInput, setNicknameInput] = useState('');

  const { data: room, isLoading: roomLoading } = useGetRoom(slug);

  const {
    socket, users, you, syncState, isLocked, allowGuestControl, allowGuestEntry, background, roomName,
    chatMessages, isPrivate, chatDisabled, micDisabled, cameraDisabled,
    emitSync, emitSeek, emitChatMessage,
    toggleLock, toggleAllowGuests, toggleGuestEntry, toggleDJ, renameRoom, toggleMedia, emitPlaylistUpdate, requestSync,
    kickUser, transferAdmin, togglePrivacy, toggleChat, toggleMic, toggleCamera,
    subtitleSync, emitSubtitleSync, emitStreamType,
  } = useSocket(slug);

  const [activeTab, setActiveTab] = useState<'chat' | 'playlist' | 'users' | 'friends'>('chat');
  const [roomProfile, setRoomProfile] = useState<{ username: string; userId?: number } | null>(null);
  const { user: authUser } = useAuth();
  const [micOn, setMicOn]       = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [bgImage, setBgImage]   = useState('');
  const [copied, setCopied]     = useState(false);
  const [isSeeking]             = useState(false);
  const [playerReady, setPlayerReady] = useState(false);

  // Room settings panel (admin only) — controlled from header button
  const [showRoomSettings, setShowRoomSettings] = useState(false);

  // Confirmation dialog before enabling mic/camera
  const [mediaConfirm, setMediaConfirm] = useState<'mic' | 'camera' | null>(null);

  // Minimised remote cams (socketIds of closed windows)
  const [hiddenCams, setHiddenCams] = useState<Set<string>>(new Set());

  const playerRef = useRef<SmartPlayerHandle>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const { remoteStreams, callAllPeers, hangUp } = useWebRTC(socket, localStream);

  const isDJ       = you?.isDJ || you?.isAdmin || false;
  const isAdmin    = you?.isAdmin || false;
  const isGuest    = !you?.userId;
  const canControl = isDJ || allowGuestControl;

  // Tell the server when the DJ hides/closes the PWA so it can swallow
  // the browser-auto-pause and keep the room playing for other viewers.
  useEffect(() => {
    if (!isDJ || !socket) return;
    const notify = () => {
      if (document.hidden) socket.emit('dj-backgrounding');
    };
    const notifyUnload = () => socket.emit('dj-backgrounding');
    document.addEventListener('visibilitychange', notify);
    window.addEventListener('pagehide', notifyUnload);
    return () => {
      document.removeEventListener('visibilitychange', notify);
      window.removeEventListener('pagehide', notifyUnload);
    };
  }, [isDJ, socket]);

  const queryClient = useQueryClient();
  const addMutation = useAddPlaylistItem();

  const handleDeleteRoom = useCallback(async () => {
    try {
      const res = await apiFetch(`/rooms/${slug}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to delete room');
        return;
      }
      navigate('/');
    } catch {
      alert('Failed to delete room');
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
      if (!syncState.url) emitSync(0, true, url);
    } catch { /* ignore */ }
  }, [slug, addMutation, queryClient, emitPlaylistUpdate, syncState.url, emitSync]);

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

  // Reset playerReady whenever the video URL changes so the initial-seek gate resets
  useEffect(() => {
    setPlayerReady(false);
    readyTimeRef.current = 0;
  }, [syncState.url]);

  // Sync effect — thresholds differ by source to avoid buffering-on-join stuttering.
  // heartbeat: correct only if >8s off (gentle drift correction)
  // action:    correct if >1.5s off (play/pause/seek from a peer)
  // initial:   threshold=Infinity — signalReady() inside HlsPlayer handles the initial
  //            seek via startPosition + canplay; the sync effect must not interfere.
  //            After the 10-second grace period, fall back to heartbeat-level threshold.
  // live:      NEVER seek by time — everyone joins at the live edge naturally.
  //            Only play/pause state is synced; HLS.js keeps all viewers at live edge.
  useEffect(() => {
    if (!playerRef.current || isSeeking || !playerReady) return;

    // For live streams, skip ALL time-based seeks.
    // The live edge is maintained automatically by HLS.js's liveSyncDurationCount setting.
    // Seeking to a specific computedTime in a live sliding window causes buffer stalls.
    if (syncState.isLive) return;

    const playerTime = playerRef.current.getCurrentTime() || 0;
    const diff = Math.abs(playerTime - syncState.time);
    const sinceReady = Date.now() - readyTimeRef.current;

    const threshold = syncState.source === 'action'    ? 1.5
                    : syncState.source === 'heartbeat' ? 8
                    : sinceReady > 10_000              ? 8
                    : Infinity; // initial within grace period — do not seek

    if (diff > threshold) {
      isRemoteSeekRef.current = true;
      playerRef.current.seekTo(syncState.time, 'seconds');
      setTimeout(() => { isRemoteSeekRef.current = false; }, 600);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncState.time, syncState.playing, syncState.source, syncState.isLive, isSeeking, playerReady]);

  const doEnableMic = useCallback(async () => {
    setMicOn(true);
    toggleMedia({ isMuted: false });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: cameraOn });
      setLocalStream(stream);
    } catch {
      setMicOn(false);
      toggleMedia({ isMuted: true });
    }
  }, [cameraOn, toggleMedia]);

  const doEnableCamera = useCallback(async () => {
    setCameraOn(true);
    toggleMedia({ isCameraOff: false });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: micOn, video: true });
      setLocalStream(stream);
    } catch {
      setCameraOn(false);
      toggleMedia({ isCameraOff: true });
    }
  }, [micOn, toggleMedia]);

  const handleToggleMic = useCallback(async () => {
    if (!micOn) {
      // Turning ON — show confirmation first
      setMediaConfirm('mic');
      return;
    }
    // Turning OFF — immediate
    setMicOn(false);
    toggleMedia({ isMuted: true });
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.stop());
      if (!cameraOn) { setLocalStream(null); hangUp(); }
    }
  }, [micOn, cameraOn, toggleMedia, localStream, hangUp]);

  const handleToggleCamera = useCallback(async () => {
    if (!cameraOn) {
      // Turning ON — show confirmation first
      setMediaConfirm('camera');
      return;
    }
    // Turning OFF — immediate
    setCameraOn(false);
    toggleMedia({ isCameraOff: true });
    if (localStream) {
      localStream.getVideoTracks().forEach(t => t.stop());
      if (!micOn) { setLocalStream(null); hangUp(); }
    }
  }, [cameraOn, micOn, toggleMedia, localStream, hangUp]);

  const handleConfirmMedia = useCallback(async () => {
    const type = mediaConfirm;
    setMediaConfirm(null);
    if (type === 'mic') await doEnableMic();
    else if (type === 'camera') await doEnableCamera();
  }, [mediaConfirm, doEnableMic, doEnableCamera]);

  useEffect(() => {
    if (localStream && users.length > 1) {
      const others = users.filter(u => u.socketId !== you?.socketId).map(u => u.socketId);
      if (others.length > 0) callAllPeers(others);
    }
  }, [localStream, users, you, callAllPeers]);

  useEffect(() => () => { localStream?.getTracks().forEach(t => t.stop()); }, [localStream]);

  // Clean up hiddenCams when a peer disconnects
  useEffect(() => {
    setHiddenCams(prev => {
      const active = new Set(remoteStreams.keys());
      const next = new Set([...prev].filter(id => active.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [remoteStreams]);

  // Force turn off mic/camera when admin disables them
  useEffect(() => {
    if (micDisabled && micOn) { setMicOn(false); toggleMedia({ isMuted: true }); }
  }, [micDisabled]);
  useEffect(() => {
    if (cameraDisabled && cameraOn) { setCameraOn(false); toggleMedia({ isCameraOff: true }); }
  }, [cameraDisabled]);

  const handlePlay  = () => { if (!canControl) return; emitSync(playerRef.current?.getCurrentTime() || 0, true,  syncState.url); };
  const handlePause = () => { if (!canControl) return; emitSync(playerRef.current?.getCurrentTime() || 0, false, syncState.url); };
  const handleSeek  = (s: number) => { if (isRemoteSeekRef.current || !canControl) return; emitSeek(s); };

  const copyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (roomLoading) return <div className="h-dvh bg-background flex items-center justify-center text-white">{t('loading')}</div>;
  if (!room)       return <div className="h-dvh bg-background flex items-center justify-center text-white">{t('roomNotFound')}</div>;

  if (!username) {
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
      className="h-dvh w-full flex flex-col overflow-hidden"
      style={{ backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm z-0" />

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="relative z-10 shrink-0 h-12 md:h-14 glass-panel border-x-0 border-t-0 flex items-center justify-between px-3 md:px-6">
        {/* Right (first in RTL): controls */}
        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          {/* Leave */}
          <button
            onClick={() => window.location.href = '/'}
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
              title={lang === 'ar' ? 'إعدادات الغرفة' : 'Room Settings'}
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

          {/* Mic / Camera */}
          <div className="flex bg-white/5 rounded-lg border border-white/10 p-0.5">
            <button
              onClick={handleToggleMic}
              disabled={micDisabled || isGuest}
              title={isGuest ? (lang === 'ar' ? 'سجّل دخولك لاستخدام المايك' : 'Sign in to use mic') : micDisabled ? (lang === 'ar' ? 'المايكروفون معطّل من المضيف' : 'Mic disabled by host') : undefined}
              className={cn('h-8 w-8 flex items-center justify-center rounded-md transition-colors',
                (micDisabled || isGuest) ? 'opacity-40 cursor-not-allowed text-white/40'
                : micOn ? 'bg-primary/20 text-primary' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              {micOn && !micDisabled && !isGuest ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4 text-red-400" />}
            </button>
            <button
              onClick={handleToggleCamera}
              disabled={cameraDisabled || isGuest}
              title={isGuest ? (lang === 'ar' ? 'سجّل دخولك لاستخدام الكاميرا' : 'Sign in to use camera') : cameraDisabled ? (lang === 'ar' ? 'الكاميرا معطّلة من المضيف' : 'Camera disabled by host') : undefined}
              className={cn('h-8 w-8 flex items-center justify-center rounded-md transition-colors',
                (cameraDisabled || isGuest) ? 'opacity-40 cursor-not-allowed text-white/40'
                : cameraOn ? 'bg-primary/20 text-primary' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              {cameraOn && !cameraDisabled && !isGuest ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4 text-red-400" />}
            </button>
          </div>
        </div>

        {/* Left (second in RTL): room name + viewer count */}
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm md:text-lg font-display font-bold text-glow truncate max-w-[130px] sm:max-w-xs md:max-w-md">
            {roomName || room.name}
          </h1>
          <span className="hidden sm:flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/70 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {users.length}
          </span>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <main className="relative z-10 flex-grow flex flex-col md:flex-row overflow-hidden min-h-0">

        {/* ── Player column ───────────────────────────────────────── */}
        <div className="flex flex-col min-h-0 md:flex-grow">

          {/* Player area:
              mobile  → fixed 16:9 aspect ratio
              md+     → flex-grow (fills all available height) */}
          <div className="w-full aspect-video md:aspect-auto md:flex-grow relative bg-black">
            {syncState.url ? (
              <SmartPlayer
                ref={playerRef}
                url={syncState.url}
                playing={syncState.playing}
                controls={canControl}
                canControl={canControl}
                initialTime={syncState.time}
                isLiveHint={syncState.isLive}
                onIsLive={emitStreamType}
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
              />
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

          </div>

          {/* Local cam — draggable, bottom-left, audio muted to avoid echo */}
          {localStream && localStream.getVideoTracks().length > 0 && (
            <DraggableCam
              key="local"
              stream={localStream}
              label={username ?? 'أنت'}
              muteAudio
              initialPos={{ x: 16, y: window.innerHeight - 140 - 80 }}
            />
          )}

          {/* Floating draggable windows for remote peers */}
          {Array.from(remoteStreams.entries()).map(([socketId, stream]) => {
            const hasVideo = stream.getVideoTracks().length > 0;
            const label = users.find(u => u.socketId === socketId)?.username || 'Peer';
            if (!hasVideo) {
              return <audio key={socketId} autoPlay playsInline ref={el => { if (el) el.srcObject = stream; }} style={{ display: 'none' }} />;
            }
            if (hiddenCams.has(socketId)) return null;
            return (
              <DraggableCam
                key={socketId}
                stream={stream}
                label={label}
                onClose={() => setHiddenCams(prev => new Set([...prev, socketId]))}
              />
            );
          })}
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
            <div className="shrink-0 px-3 py-2.5 border-b border-white/10">
              <YoutubeSearch
                onAdd={handleAddVideo}
                isAdding={addMutation.isPending}
                lang={lang}
              />
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-white/10 shrink-0">
            {TABS.map(({ id, Icon, label }) => {
              const hasChatAlert  = id === 'chat'  && chatDisabled;
              const hasMediaAlert = id === 'users' && (micDisabled || cameraDisabled);
              const hasAlert = hasChatAlert || hasMediaAlert;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] md:text-xs font-medium transition-colors border-b-2 relative',
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
                  cameraDisabled={cameraDisabled}
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
              cameraDisabled={cameraDisabled}
              toggleAllowGuests={toggleAllowGuests}
              toggleGuestEntry={toggleGuestEntry}
              togglePrivacy={togglePrivacy}
              toggleChat={toggleChat}
              toggleMic={toggleMic}
              toggleCamera={toggleCamera}
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
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMediaConfirm(null)} />

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="relative w-full max-w-sm mx-4 mb-8 sm:mb-0 rounded-2xl overflow-hidden"
            style={{ background: 'rgba(18,18,20,0.97)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            {/* Icon */}
            <div className="flex flex-col items-center gap-3 pt-8 pb-2 px-6">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${mediaConfirm === 'mic' ? 'bg-cyan-500/15' : 'bg-violet-500/15'}`}>
                {mediaConfirm === 'mic'
                  ? <Mic className="w-8 h-8 text-cyan-400" />
                  : <Video className="w-8 h-8 text-violet-400" />
                }
              </div>
              <h3 className="text-white font-bold text-lg text-center">
                {mediaConfirm === 'mic' ? 'فتح المايكروفون؟' : 'فتح الكاميرا؟'}
              </h3>
              <p className="text-white/50 text-sm text-center leading-relaxed">
                {mediaConfirm === 'mic'
                  ? 'سيتمكن المشاركون في الغرفة من سماعك. هل تريد المتابعة؟'
                  : 'سيتمكن المشاركون في الغرفة من رؤيتك. هل تريد المتابعة؟'
                }
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-2 p-4 pt-3">
              <button
                onClick={() => setMediaConfirm(null)}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmMedia}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold text-black transition ${mediaConfirm === 'mic' ? 'bg-cyan-400 hover:bg-cyan-300' : 'bg-violet-400 hover:bg-violet-300'}`}
              >
                {mediaConfirm === 'mic' ? 'نعم، افتح المايك' : 'نعم، افتح الكاميرا'}
              </button>
            </div>

            {/* Safe area */}
            <div style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} />
          </motion.div>
        </div>,
        document.body
      )}
    </div>
  );
}
