import { norm } from "./normalize";

/** Canonical Indian city → aliases (normalised forms). Bengaluru first. */
export const INDIA_CITIES: Record<string, string[]> = {
  Bengaluru: ["bengaluru", "bangalore", "blr", "bengalooru", "whitefield", "indiranagar", "koramangala", "yelahanka", "hebbal", "jayanagar", "rajajinagar", "electronic city"],
  Mumbai: ["mumbai", "bombay", "bkc", "andheri", "worli", "navi mumbai", "lower parel", "bandra", "thane"],
  "Delhi NCR": ["delhi", "new delhi", "ncr", "delhi ncr", "gurugram", "gurgaon", "noida", "greater noida", "faridabad"],
  Hyderabad: ["hyderabad", "secunderabad", "hitec city", "gachibowli"],
  Chennai: ["chennai", "madras"],
  Kolkata: ["kolkata", "calcutta"],
  Pune: ["pune", "poona"],
  Goa: ["goa", "vagator", "anjuna", "panaji", "panjim", "calangute", "baga", "morjim"],
  Ahmedabad: ["ahmedabad", "gandhinagar"],
  Jaipur: ["jaipur"],
  Kochi: ["kochi", "cochin", "ernakulam"],
  Chandigarh: ["chandigarh", "mohali", "panchkula"],
  Shillong: ["shillong"],
  Guwahati: ["guwahati"],
  Indore: ["indore"],
  Lucknow: ["lucknow"],
  Mysuru: ["mysuru", "mysore"],
  Visakhapatnam: ["visakhapatnam", "vizag"],
  Thiruvananthapuram: ["thiruvananthapuram", "trivandrum"],
  Coimbatore: ["coimbatore"],
  Mangaluru: ["mangaluru", "mangalore"],
  Puducherry: ["puducherry", "pondicherry", "pondy"],
  Surat: ["surat"],
  Nagpur: ["nagpur"],
  Bhopal: ["bhopal"],
  Dehradun: ["dehradun"],
  Kasauli: ["kasauli"],
  Udaipur: ["udaipur"],
  Ziro: ["ziro"],
};

/** Words that indicate India but not a city (pre-filter only, never stored as city). */
export const INDIA_WORDS = ["india", "indian tour", "india tour", "karnataka", "maharashtra", "kerala", "tamil nadu"];

// Short aliases that collide with English words need word boundaries AND are never matched alone in URLs.
const AMBIGUOUS = new Set(["blr", "ncr", "bkc", "baga", "pondy"]);

const aliasIndex: { alias: string; city: string; re: RegExp }[] = Object.entries(INDIA_CITIES)
  .flatMap(([city, aliases]) => aliases.map((alias) => ({ alias, city })))
  .sort((a, b) => b.alias.length - a.alias.length)
  .map(({ alias, city }) => ({ alias, city, re: new RegExp(`(?:^| )${alias}(?: |$)`) }));

/** Canonical city for a free-text location, or null if not an Indian city we know. */
export function canonicalCity(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = norm(text);
  for (const { city, re } of aliasIndex) if (re.test(t)) return city;
  return null;
}

/** All canonical cities mentioned in a text, in order of first mention. */
export function citiesIn(text: string, opts: { strict?: boolean } = {}): string[] {
  const t = norm(text);
  const hits: { city: string; at: number }[] = [];
  for (const { alias, city, re } of aliasIndex) {
    if (opts.strict && AMBIGUOUS.has(alias)) continue;
    const m = re.exec(t);
    if (m && !hits.some((h) => h.city === city)) hits.push({ city, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.city);
}

export function mentionsIndia(text: string): boolean {
  const t = norm(text);
  return citiesIn(t, { strict: true }).length > 0 || INDIA_WORDS.some((w) => t.includes(w));
}

export function isHomeCity(city: string | null | undefined, home = "Bengaluru"): boolean {
  return !!city && canonicalCity(city) === canonicalCity(home);
}
