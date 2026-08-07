import { Marked, type RendererObject, type Tokens } from "marked";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  colon: ":",
  Tab: "\t",
  NewLine: "\n",
};

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const codePoint =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });

const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const CONTROL_AND_WHITESPACE = /[\x00-\x20\x7f]+/g;

const isSafeUrl = (rawHref: string): boolean => {
  const normalized = decodeEntities(rawHref).replace(CONTROL_AND_WHITESPACE, "").toLowerCase();

  if (normalized === "") return true;
  if (
    normalized.startsWith("#") ||
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  ) {
    return true;
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (!schemeMatch) return true;

  return SAFE_URL_SCHEMES.has(`${schemeMatch[1]}:`);
};

const sanitizeUrl = (href: string): string => (isSafeUrl(href) ? href : "#");

const isExternalUrl = (href: string): boolean => /^https?:\/\//i.test(href);

const renderer: RendererObject = {
  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
  },
  link({ href, title, tokens }: Tokens.Link): string {
    const safeHref = sanitizeUrl(href);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const relAttr = isExternalUrl(safeHref) ? ' rel="noopener noreferrer" target="_blank"' : "";
    const body = this.parser.parseInline(tokens);
    return `<a href="${escapeHtml(safeHref)}"${titleAttr}${relAttr}>${body}</a>`;
  },
  image({ href, title, text }: Tokens.Image): string {
    const safeHref = sanitizeUrl(href);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeHtml(safeHref)}" alt="${escapeHtml(text)}"${titleAttr}>`;
  },
};

const instance = new Marked({ renderer, gfm: true });

/**
 * Renders markdown to HTML that is safe to inline without further escaping.
 *
 * Raw HTML in the source is never emitted as live markup: `marked`'s `html`
 * renderer is overridden to escape it to visible text instead. Link and
 * image URLs are restricted to http(s)/mailto/relative schemes, closing off
 * `javascript:`/`data:`/etc. as an injection vector even though marked
 * itself performs no such filtering.
 */
export const renderMarkdown = (source: string): string => instance.parse(source, { async: false });
