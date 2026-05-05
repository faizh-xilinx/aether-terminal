import { create } from "zustand";

import { DEFAULT_THEME, THEMES, type AetherTheme } from "@/lib/themes";

interface UIStore {
  paletteOpen: boolean;
  connectOpen: boolean;
  aiOpen: boolean;
  authOpen: boolean;
  theme: AetherTheme;
  togglePalette: (open?: boolean) => void;
  toggleConnect: (open?: boolean) => void;
  toggleAi: (open?: boolean) => void;
  toggleAuth: (open?: boolean) => void;
  setTheme: (id: string) => void;
}

export const useUI = create<UIStore>((set) => ({
  paletteOpen: false,
  connectOpen: false,
  aiOpen: true,
  authOpen: false,
  theme: DEFAULT_THEME,
  togglePalette: (open) =>
    set((s) => ({ paletteOpen: open ?? !s.paletteOpen })),
  toggleConnect: (open) =>
    set((s) => ({ connectOpen: open ?? !s.connectOpen })),
  toggleAi: (open) => set((s) => ({ aiOpen: open ?? !s.aiOpen })),
  toggleAuth: (open) => set((s) => ({ authOpen: open ?? !s.authOpen })),
  setTheme: (id) =>
    set(() => ({
      theme: THEMES.find((t) => t.id === id) ?? DEFAULT_THEME,
    })),
}));
