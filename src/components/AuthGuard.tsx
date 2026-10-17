"use client";

import { useEffect } from "react";

export default function AuthGuard() {
  useEffect(() => {
    const w = window as unknown as { __authGuardInstalled?: boolean };
    if (w.__authGuardInstalled) return;
    w.__authGuardInstalled = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL | Request, init?: RequestInit) => {
      const res = await originalFetch(input, init);
      try {
        if (res.status === 401) {
          const raw =
            typeof input === "string"
              ? input
              : input instanceof URL
              ? input.href
              : input.url;
          const url = new URL(raw, window.location.origin);
          const isAuthEndpoint = url.pathname.startsWith("/api/auth/");
          const onAuthPage =
            window.location.pathname.startsWith("/login") ||
            window.location.pathname.startsWith("/setup");
          if (!isAuthEndpoint && !onAuthPage) {
            window.location.href = "/login";
          }
        }
      } catch {}
      return res;
    };
  }, []);
  return null;
}
