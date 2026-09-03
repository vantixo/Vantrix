/**
 * Country list + flag helper — Vantrix
 *
 * FLAGS-FIX: the profile "Country" field was a raw 2-letter text input
 * with no flag, no autocomplete, and no protection against typos. This
 * gives every ISO 3166-1 alpha-2 code a rendered flag (computed, not a
 * hardcoded glyph table — works for any valid code) plus a curated,
 * alphabetized list for the picker UI.
 */

/** Converts an ISO 3166-1 alpha-2 code ("US", "ng") into its flag emoji. */
export function countryCodeToFlag(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "🏳️";
  const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - 65; // 'A'.charCodeAt(0)
  return [...upper]
    .map((ch) => String.fromCodePoint(ch.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET))
    .join("");
}

export interface CountryOption {
  code: string; // ISO 3166-1 alpha-2
  name: string;
}

// Curated, alphabetized-by-name list covering Vantrix's primary markets.
// Not exhaustive by design — the picker also accepts free typing for any
// valid 2-letter code, which still renders a correct flag via the
// function above.
export const COUNTRIES: CountryOption[] = [
  { code: "AR", name: "Argentina" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BR", name: "Brazil" },
  { code: "CA", name: "Canada" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "DK", name: "Denmark" },
  { code: "EG", name: "Egypt" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JP", name: "Japan" },
  { code: "KE", name: "Kenya" },
  { code: "MY", name: "Malaysia" },
  { code: "MX", name: "Mexico" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NG", name: "Nigeria" },
  { code: "NO", name: "Norway" },
  { code: "PK", name: "Pakistan" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SG", name: "Singapore" },
  { code: "ZA", name: "South Africa" },
  { code: "KR", name: "South Korea" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "TH", name: "Thailand" },
  { code: "TR", name: "Turkey" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "VN", name: "Vietnam" },
];
