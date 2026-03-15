import React, { createContext, useContext, useEffect, useState } from 'react';

type Language = 'en' | 'ar';

const translations = {
  en: {
    // Landing
    tagline: "Watch together, miles apart.",
    description: "Create a room, invite friends, and watch videos in perfect sync. Chat, react, and call in real-time.",
    createRoom: "Create Room",
    joinRoom: "Join Room",
    roomName: "Room Name",
    username: "Your Nickname",
    public: "Public",
    private: "Private",
    roomCode: "Room Code / Slug",
    startWatching: "Start Watching",
    join: "Join",
    
    // Room
    chat: "Live Chat",
    playlist: "Playlist",
    users: "Users",
    friends: "Friends",
    typeMessage: "Type a message...",
    addVideo: "Add Video URL",
    videoUrl: "YouTube, Twitch, Vimeo, MP4...",
    addToQueue: "Add to Queue",
    lockPlayer: "Lock Player",
    unlockPlayer: "Unlock Player",
    grantDJ: "Grant DJ",
    revokeDJ: "Revoke DJ",
    mic: "Microphone",
    camera: "Camera",
    leave: "Leave Room",
    viewers: "viewers",
    nowPlaying: "Now Playing",
    nothingPlaying: "Nothing is playing. Add a video to the playlist!",
    copyLink: "Copy Link",
    copied: "Copied!",
    
    // System Messages
    joinedRoom: "joined the room",
    leftRoom: "left the room",
    becameDJ: "is now a DJ",
    lostDJ: "is no longer a DJ",
    playerLocked: "The player has been locked by an admin",
    playerUnlocked: "The player has been unlocked",
    
    // Backgrounds
    changeBackground: "Change Lounge",
    bgNeonCity: "Neon City",
    bgHomeTheater: "Home Theater",
    bgVoid: "The Void",

    // Extra UI
    multiSource: "Multi-source",
    perfectSync: "Perfect Sync",
    admin: "Admin",
    adminControls: "Admin Controls",
    djOnly: "Only DJs can control playback",
    backToUsers: "Back to Users",
    viewer: "Viewer",
    loading: "Loading...",
    roomNotFound: "Room not found",
    you: "You",
    enterNickname: "Enter your nickname",
    yourNickname: "Your Nickname",
    videoError: "Cannot play this video",
    videoErrorDesc: "The video URL may be invalid or the format is not supported.",
    videoErrorIpLocked: "Stream is access-restricted",
    videoErrorIpLockedDesc: "This stream only allows playback from the original network it was opened on. Try opening the link directly in your browser.",
    videoErrorProxyRequired: "Stream requires routing",
    videoErrorProxyRequiredDesc: "This stream can't be played directly. You can load it through our free proxy — it may be slightly slower.",
    videoErrorProxyBtn: "Load via proxy",
    tapToPlay: "Tap to play"
  },
  ar: {
    // Landing
    tagline: "شاهدوا معاً، مهما بعدت المسافات.",
    description: "أنشئ غرفة، ادعُ أصدقاءك، وشاهدوا مقاطع الفيديو بتزامن مثالي. دردش، تفاعل، واتصل في الوقت الفعلي.",
    createRoom: "إنشاء غرفة",
    joinRoom: "الانضمام لغرفة",
    roomName: "اسم الغرفة",
    username: "اسمك المستعار",
    public: "عام",
    private: "خاص",
    roomCode: "رمز الغرفة",
    startWatching: "ابدأ المشاهدة",
    join: "انضمام",
    
    // Room
    chat: "الدردشة",
    playlist: "قائمة التشغيل",
    users: "المستخدمون",
    friends: "الأصدقاء",
    typeMessage: "اكتب رسالة...",
    addVideo: "إضافة رابط فيديو",
    videoUrl: "يوتيوب، تويتش، فيميو، MP4...",
    addToQueue: "أضف للقائمة",
    lockPlayer: "قفل المشغل",
    unlockPlayer: "فتح المشغل",
    grantDJ: "منح صلاحية DJ",
    revokeDJ: "إلغاء صلاحية DJ",
    mic: "الميكروفون",
    camera: "الكاميرا",
    leave: "مغادرة الغرفة",
    viewers: "مشاهدين",
    nowPlaying: "يعرض الآن",
    nothingPlaying: "لا يوجد شيء يعرض. أضف فيديو للقائمة!",
    copyLink: "نسخ الرابط",
    copied: "تم النسخ!",
    
    // System Messages
    joinedRoom: "انضم للغرفة",
    leftRoom: "غادر الغرفة",
    becameDJ: "أصبح الآن DJ",
    lostDJ: "فقد صلاحية DJ",
    playerLocked: "تم قفل المشغل من قبل المشرف",
    playerUnlocked: "تم فتح المشغل",
    
    // Backgrounds
    changeBackground: "تغيير الخلفية",
    bgNeonCity: "مدينة النيون",
    bgHomeTheater: "مسرح منزلي",
    bgVoid: "الفراغ",

    // Extra UI
    multiSource: "متعدد المصادر",
    perfectSync: "مزامنة مثالية",
    admin: "مشرف",
    adminControls: "لوحة التحكم",
    djOnly: "فقط الـ DJ يمكنه التحكم بالتشغيل",
    backToUsers: "العودة للمستخدمين",
    viewer: "مشاهد",
    loading: "جاري التحميل...",
    roomNotFound: "الغرفة غير موجودة",
    you: "أنت",
    enterNickname: "أدخل اسمك المستعار",
    yourNickname: "اسمك المستعار",
    videoError: "لا يمكن تشغيل هذا الفيديو",
    videoErrorDesc: "قد يكون رابط الفيديو غير صالح أو التنسيق غير مدعوم.",
    videoErrorIpLocked: "البث مقيّد بالشبكة",
    videoErrorIpLockedDesc: "هذا البث لا يسمح إلا بالتشغيل من نفس الجهاز الذي فُتح منه الرابط. جرّب فتح الرابط مباشرةً في المتصفح.",
    videoErrorProxyRequired: "البث يحتاج توجيهاً",
    videoErrorProxyRequiredDesc: "لا يمكن تشغيل هذا البث مباشرةً. يمكنك تحميله عبر الـ proxy المجاني — قد يكون أبطأ قليلاً.",
    videoErrorProxyBtn: "تحميل عبر الـ proxy",
    tapToPlay: "اضغط للتشغيل"
  }
};

type Translations = typeof translations.en;
type TranslationKey = keyof Translations;

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

function detectDefaultLanguage(): Language {
  const deviceLang = navigator.language || (navigator as any).userLanguage || '';
  return deviceLang.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(detectDefaultLanguage);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
  };

  const t = (key: TranslationKey) => translations[lang][key];

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within an I18nProvider');
  return context;
}
