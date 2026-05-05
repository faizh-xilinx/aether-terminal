import { create } from "zustand";

import { ipc, type AuthStatus } from "@/lib/ipc";

interface AuthStore {
  status: AuthStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  saveToken: (token: string) => Promise<void>;
  forget: () => Promise<void>;
}

export const useAuth = create<AuthStore>((set) => ({
  status: null,
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const status = await ipc.authStatus();
      set({ status });
    } finally {
      set({ loading: false });
    }
  },
  saveToken: async (token: string) => {
    await ipc.authSaveToken(token);
    const status = await ipc.authStatus();
    set({ status });
  },
  forget: async () => {
    await ipc.authForget();
    const status = await ipc.authStatus();
    set({ status });
  },
}));
