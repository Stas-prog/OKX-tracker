"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type Snapshot = {
    instId: string;
    tf: string;
    sim: any;
    candles: any[];
    savedAt: string;
};

type TraderStore = {
    simSnapshot: Snapshot | null;
    setSimSnapshot: (s: Snapshot) => void;
    reset: () => void;
};

export const useTraderStore = create<TraderStore>()(
    persist(
        (set) => ({
            simSnapshot: null,
            setSimSnapshot: (s) => set({ simSnapshot: s }),
            reset: () => set({ simSnapshot: null }),
        }),
        {
            name: "okx-trader-sim",
            storage: createJSONStorage(() => localStorage),
            version: 1,
        }
    )
);
