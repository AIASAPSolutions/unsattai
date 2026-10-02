import { GARMENTS, LANGUAGES, PROMPT_LIMIT, TEXT_LIMITS, type Garment, type Language } from '../../api/types';

export interface DesignLink {
  prompt: string | null;
  garment: Garment | null;
  team_name: string | null;
  language: Language | null;
  autostart: boolean;
}

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * Reads unsattai://design?prompt=…&garment=…&team=…&lang=…&autostart=1.
 * Values that are out of range are dropped rather than trimmed silently, and
 * nothing else in the link (such as an API key or server address) is used.
 */
export function parseDesignLink(params: Params): DesignLink {
  const prompt = first(params.prompt).trim();
  const garment = first(params.garment).trim().toLowerCase();
  const team = first(params.team).trim();
  const lang = first(params.lang ?? params.language).trim().toLowerCase();
  const auto = first(params.autostart).trim().toLowerCase();
  return {
    prompt: prompt && prompt.length <= PROMPT_LIMIT ? prompt : null,
    garment: (GARMENTS as readonly string[]).includes(garment) ? (garment as Garment) : null,
    team_name: team && [...team].length <= TEXT_LIMITS.team_name ? team : null,
    language: (LANGUAGES as readonly string[]).includes(lang) ? (lang as Language) : null,
    autostart: ['1', 'true', 'yes'].includes(auto),
  };
}
