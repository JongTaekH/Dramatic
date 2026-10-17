"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";

export default function FavoriteButton({
  animeId,
  animeTitle,
  animePoster,
}: {
  animeId: string;
  animeTitle: string;
  animePoster?: string;
}) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/anime/favorite?id=${animeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setIsFavorited(d.is_favorited);
      })
      .catch(() => {});
  }, [animeId]);

  const toggleFavorite = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/anime/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ animeId, animeTitle, animePoster: animePoster || "" }),
      });
      const data = await res.json();
      if (data.success) {
        setIsFavorited(data.is_favorited);
      }
    } catch {}
    setLoading(false);
  };

  return (
    <button
      type="button"
      onClick={toggleFavorite}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition border cursor-pointer active:scale-95 ${
        isFavorited
          ? "bg-amber-500/15 text-amber-300 border-amber-500/50 shadow-md shadow-amber-500/10"
          : "bg-[#333333] text-[#D4D4D4] border-[#B3B3B3]/20 hover:border-amber-400/40 hover:bg-[#3B3B3B] hover:text-[#FFFFFF]"
      }`}
    >
      <Star
        className={`h-4 w-4 transition ${
          isFavorited ? "fill-amber-400 text-amber-400" : "text-[#B3B3B3]"
        }`}
      />
      <span>{isFavorited ? "즐겨찾기 중" : "즐겨찾기 추가"}</span>
    </button>
  );
}
