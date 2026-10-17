"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

export default function NavbarSearch() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const draftRef = useRef("");
  const composingRef = useRef(false);
  const restorePageRef = useRef<(() => void) | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const restorePage = useCallback(() => {
    restorePageRef.current?.();
    restorePageRef.current = null;
    composingRef.current = false;
  }, []);

  const finishClose = useCallback(() => {
    restorePage();
    if (mobileInputRef.current) draftRef.current = mobileInputRef.current.value;
    if (desktopInputRef.current) desktopInputRef.current.value = draftRef.current;
    setIsOpen(false);
  }, [restorePage]);

  const closeSearch = useCallback(
    (toDesktop = false) => {
      if (!dialogRef.current?.open) return;
      dialogRef.current.close();
      finishClose();
      const target = toDesktop ? desktopInputRef.current : triggerRef.current;
      target?.focus({ preventScroll: true });
    },
    [finishClose]
  );

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const handleResize = () => {
      if (desktop.matches) closeSearch(true);
    };
    const handleHistoryNavigation = () => closeSearch();
    desktop.addEventListener("change", handleResize);
    window.addEventListener("popstate", handleHistoryNavigation);
    return () => {
      desktop.removeEventListener("change", handleResize);
      window.removeEventListener("popstate", handleHistoryNavigation);
      restorePage();
    };
  }, [closeSearch, restorePage]);

  const openSearch = () => {
    const dialog = dialogRef.current;
    const input = mobileInputRef.current;
    if (!dialog || !input || dialog.open) return;

    input.value = draftRef.current;
    composingRef.current = false;
    const { scrollX, scrollY } = window;
    const { style } = document.body;
    const properties = ["position", "top", "left", "right", "width", "overflow"] as const;
    const previous = properties.map((property) => style[property]);
    restorePageRef.current = () => {
      properties.forEach((property, index) => {
        style[property] = previous[index];
      });
      window.scrollTo(scrollX, scrollY);
    };
    Object.assign(style, {
      position: "fixed",
      top: `-${scrollY}px`,
      left: "0",
      right: "0",
      width: "100%",
      overflow: "hidden",
    });

    dialog.showModal();
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    setIsOpen(true);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (composingRef.current) return;
    const input = event.currentTarget.elements.namedItem("q") as HTMLInputElement;
    const keyword = input.value.trim();
    if (!keyword) {
      input.focus();
      return;
    }
    closeSearch();
    input.blur();
    router.push(`/?tab=search&q=${encodeURIComponent(keyword)}`);
  };

  const inputProps = {
    type: "text",
    name: "q",
    enterKeyHint: "search" as const,
    autoComplete: "off",
    autoCapitalize: "none",
    spellCheck: false,
    "aria-label": "드라마 제목 검색",
    placeholder: "드라마 제목 검색...",
    onInput: (event: React.FormEvent<HTMLInputElement>) => {
      draftRef.current = event.currentTarget.value;
    },
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      draftRef.current = event.currentTarget.value;
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        event.key === "Enter" &&
        (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      ) {
        event.preventDefault();
      }
    },
  };

  return (
    <div className="min-w-0 flex-1 lg:mx-4 lg:max-w-sm">
      <button
        ref={triggerRef}
        type="button"
        aria-label="드라마 검색 열기"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={openSearch}
        className="ml-auto flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-[#333333] text-white sm:w-full sm:justify-start sm:gap-2 sm:px-3 lg:hidden"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden truncate text-sm text-[#B3B3B3] sm:block">드라마 제목 검색</span>
      </button>

      <form role="search" onSubmit={handleSubmit} className="relative hidden lg:block">
        <input
          ref={desktopInputRef}
          {...inputProps}
          className="w-full min-w-0 rounded-full border border-white/20 bg-[#333333] py-2 pl-10 pr-4 text-base text-white outline-none placeholder:text-[#B3B3B3] focus:border-white focus:ring-1 focus:ring-white"
        />
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B3B3B3]"
        />
      </form>

      <dialog
        ref={dialogRef}
        aria-labelledby="mobile-search-title"
        className="mobile-search-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeSearch();
        }}
        onClose={() => {
          if (!dialogRef.current?.open) finishClose();
        }}
      >
        <div className="mobile-search-panel">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 id="mobile-search-title" className="text-lg font-bold text-white">
              드라마 검색
            </h2>
            <button
              type="button"
              aria-label="검색 닫기"
              onClick={() => closeSearch()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          <form role="search" onSubmit={handleSubmit}>
            <label htmlFor="mobile-drama-search" className="mb-3 block text-sm text-[#D4D4D4]">
              찾고 싶은 드라마 제목을 입력하세요
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#B3B3B3]"
              />
              <input
                id="mobile-drama-search"
                ref={mobileInputRef}
                {...inputProps}
                className="w-full min-w-0 rounded-2xl border border-white/30 bg-[#333333] py-4 pl-12 pr-4 text-lg leading-6 text-white caret-white outline-none placeholder:text-[#B3B3B3] focus:border-white focus:ring-1 focus:ring-white"
              />
            </div>
            <button
              type="submit"
              className="mt-4 min-h-12 w-full rounded-2xl bg-white px-5 py-3 text-base font-bold text-[#2B2B2B] hover:bg-[#D4D4D4]"
            >
              검색
            </button>
          </form>
        </div>
      </dialog>
    </div>
  );
}
