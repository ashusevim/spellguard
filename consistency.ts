import { preprocessLines } from "./checker.ts";

/**
 * Terminology-consistency lint: deterministic checks that need no LLM.
 *
 * 1. Brand casing — curated mixed-case terms ("GitHub", "TypeScript",
 *    "iOS") written in the wrong case. ALL-CAPS renderings (headings) and
 *    plural/possessive stems ("APIs", "GitHub's") are accepted.
 * 2. Separator variants — the same word written with different separators
 *    ("backend" vs "back-end", "x86-64" vs "x86_64"). Purely structural:
 *    no list needed. Case-only differences ("Web" vs "web") are never
 *    flagged — that's normal English.
 */

export interface ConsistencyForm {
  form: string;
  lines: number[];
  count: number;
}

export interface ConsistencyFinding {
  /** "casing" = wrong brand casing; "variants" = mixed separator styles. */
  kind: "casing" | "variants";
  /** The recommended rendering. */
  recommendation: string;
  forms: ConsistencyForm[];
  lines: number[];
}

export interface ConsistencyOptions {
  markdown?: boolean;
}

// Curated brand terms: display form (what to recommend) — comparison
// happens on the alphanumeric projection ("Node.js" -> "Nodejs").
const BRANDS = [
  "GitHub", "GitLab", "Bitbucket", "JavaScript", "TypeScript", "Node.js",
  "Next.js", "Vue.js", "npm", "iOS", "iPadOS", "macOS", "MySQL", "PostgreSQL",
  "SQLite", "MongoDB", "GraphQL", "WebSocket", "WebAssembly", "OpenAI",
  "ChatGPT", "YouTube", "LinkedIn", "DevOps", "Kubernetes", "Nginx", "Linux",
  "Unix", "Unicode", "ASCII", "UTF-8", "API", "CLI", "GUI", "UI", "UX",
  "HTTP", "HTTPS", "JSON", "YAML", "XML", "TOML", "SQL", "NoSQL", "CSS",
  "HTML", "URL", "URI", "UUID", "CRUD", "SDK", "DNS", "TCP", "UDP", "SSH",
  "TLS", "SSL", "VPN", "CDN", "CPU", "GPU", "RAM", "SSD", "AI", "ML", "LLM",
  "GPT", "RAG", "AWS", "GCP", "SaaS", "OAuth", "JWT", "REST", "XSS", "CSRF",
  "CORS", "FAQ", "CI", "IP",
];

const BRAND_BY_LOWER_ALPHA = new Map<string, { display: string; alpha: string }>();
for (const brand of BRANDS) {
  const alpha = brand.replace(/[^A-Za-z0-9]/g, "");
  BRAND_BY_LOWER_ALPHA.set(alpha.toLowerCase(), { display: brand, alpha });
}

/**
 * Strips punctuation while KEEPING internal separators, so "back-end"
 * survives as "back-end" (cleanWord would collapse it to "backend").
 */
function wordForm(token: string): string {
  return token
    .replace(/[^A-Za-z0-9'_-]/g, "")
    .replace(/^[-']+|[-']+$/g, "");
}

function groupKey(form: string): string {
  return form.toLowerCase().replace(/[-_']/g, "");
}

export function findInconsistencies(
  text: string,
  options: ConsistencyOptions = {},
): ConsistencyFinding[] {
  const casing = new Map<string, { bad: string; lines: number[] }>();
  const groups = new Map<string, Map<string, { form: string; lines: number[]; count: number }>>();

  for (const { line: lineNumber, tokens } of preprocessLines(text, options.markdown ?? false)) {
    for (const token of tokens) {
      const form = wordForm(token);
      if (form.length < 2) continue;

      // --- Brand casing check ---
      const alphaRaw = form.replace(/[^A-Za-z0-9]/g, "");
      // Plural/possessive stems ("APIs", "GitHub's"): strip a trailing "s"
      // before the lookup so "Githubs" still flags against "GitHub".
      let brand = BRAND_BY_LOWER_ALPHA.get(alphaRaw.toLowerCase());
      let alpha = alphaRaw;
      if (!brand && alpha.toLowerCase().endsWith("s")) {
        const stem = alpha.slice(0, -1);
        const stemBrand = BRAND_BY_LOWER_ALPHA.get(stem.toLowerCase());
        if (stemBrand) {
          brand = stemBrand;
          alpha = stem;
        }
      }
      if (brand) {
        const isAllCaps = alpha === alpha.toUpperCase() && /[A-Z]/.test(alpha);
        if (alpha !== brand.alpha && !isAllCaps) {
          const entry = casing.get(alpha) ?? { bad: alpha, lines: [] };
          if (!entry.lines.includes(lineNumber)) entry.lines.push(lineNumber);
          casing.set(alpha, entry);
        }
      }

      // --- Separator variant check ---
      const key = groupKey(form);
      if (key.length >= 3 && /[a-z]/i.test(form)) {
        let group = groups.get(key);
        if (!group) groups.set(key, (group = new Map()));
        const variantKey = form.toLowerCase();
        const variant = group.get(variantKey);
        if (variant) {
          variant.count++;
          if (!variant.lines.includes(lineNumber)) variant.lines.push(lineNumber);
        } else {
          group.set(variantKey, { form, lines: [lineNumber], count: 1 });
        }
      }
    }
  }

  const findings: ConsistencyFinding[] = [];

  for (const { bad, lines } of casing.values()) {
    const brand = BRAND_BY_LOWER_ALPHA.get(bad.toLowerCase())!;
    findings.push({
      kind: "casing",
      recommendation: brand.display,
      forms: [{ form: bad, lines, count: lines.length }],
      lines: [...lines],
    });
  }

  for (const group of groups.values()) {
    if (group.size < 2) continue;
    const forms = [...group.values()].sort(
      (a, b) =>
        b.count - a.count ||
        a.form.length - b.form.length ||
        a.form.localeCompare(b.form),
    );
    findings.push({
      kind: "variants",
      recommendation: forms[0].form,
      forms,
      lines: [...new Set(forms.flatMap((f) => f.lines))].sort((a, b) => a - b),
    });
  }

  return findings.sort((a, b) => Math.min(...a.lines) - Math.min(...b.lines));
}
