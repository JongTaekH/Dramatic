import { AnimeProvider } from "./types";
import { tvwikiProvider, TVWIKI_SORT_OPTIONS, TVWIKI_CATEGORIES } from "./tvwiki";

export * from "./types";
export * from "./tvwiki";

export const ANISSIA_PREFIX = "ani_";
export const OHLI24_PREFIX = "ol_";
export const REANIME_PREFIX = "re_";

export const LINKKF_GENRES: string[] = [];
export const LINKKF_YEARS: string[] = [];
export const LINKKF_TYPES: string[] = [];
export const REANIME_GENRES: string[] = [];
export const ANISSIA_PRIMARY_GENRES: string[] = [];
export const ANISSIA_ALL_GENRES: string[] = [];

export function isAnissiaId(id: string): boolean {
  return typeof id === "string" && id.startsWith(ANISSIA_PREFIX);
}

export function isOhli24Id(id: string): boolean {
  return typeof id === "string" && id.startsWith(OHLI24_PREFIX);
}

export function isReanimeId(id: string): boolean {
  return typeof id === "string" && id.startsWith(REANIME_PREFIX);
}

export function getProvider(_sourceName?: string | null): AnimeProvider {
  return tvwikiProvider;
}

export function getProviderByAnimeId(_animeId: string): AnimeProvider {
  return tvwikiProvider;
}

export { TVWIKI_SORT_OPTIONS, TVWIKI_CATEGORIES };
