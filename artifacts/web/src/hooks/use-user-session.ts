import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserSessionState {
  username: string;
  setUsername: (name: string) => void;
  avatarColor: string;
}

export const useUserSession = create<UserSessionState>()(
  persist(
    (set) => ({
      username: '',
      avatarColor: `hsl(${Math.random() * 360}, 80%, 60%)`,
      setUsername: (name) => set({ username: name }),
    }),
    {
      name: 'lrmtv-session',
    }
  )
);
