"use client";
import { useEffect, useRef } from "react";
import { OkxWs } from "@/lib/okxWs";

type UseOkxWsOpts = ConstructorParameters<typeof OkxWs>[0] & {
  subscribe?: { channel: string; instId: string }[];
};

export function useOkxWs(opts: UseOkxWsOpts) {
  const ref = useRef<OkxWs | null>(null);

  useEffect(() => {
    const ws = new OkxWs(opts);
    ref.current = ws;
    ws.connect();
    if (opts.subscribe?.length) ws.subscribe(opts.subscribe);

    return () => {
      try { ws.close(); } catch {}
      ref.current = null;
    };
  }, [JSON.stringify(opts.subscribe)]);

  return ref;
}
