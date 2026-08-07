import { expect, test } from "bun:test";
import { renderMarkdown } from "./Markdown.ts";

test("renders headings", () => {
  expect(renderMarkdown("# Title\n\n## Subtitle")).toContain("<h1>Title</h1>");
  expect(renderMarkdown("# Title\n\n## Subtitle")).toContain("<h2>Subtitle</h2>");
});

test("renders bold and italic", () => {
  const html = renderMarkdown("**bold** and _italic_");
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<em>italic</em>");
});

test("renders unordered and ordered lists", () => {
  const unordered = renderMarkdown("- one\n- two");
  expect(unordered).toContain("<ul>");
  expect(unordered).toContain("<li>one</li>");

  const ordered = renderMarkdown("1. one\n2. two");
  expect(ordered).toContain("<ol>");
  expect(ordered).toContain("<li>two</li>");
});

test("renders links", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");
  expect(html).toContain('href="https://example.com/docs"');
  expect(html).toContain(">docs</a>");
});

test("renders inline code and fenced code blocks", () => {
  expect(renderMarkdown("use `renderMarkdown()`")).toContain("<code>renderMarkdown()</code>");

  const fenced = renderMarkdown("```js\nconst x = 1;\n```");
  expect(fenced).toContain("<pre><code");
  expect(fenced).toContain("const x = 1;");
});

test("renders blockquotes", () => {
  expect(renderMarkdown("> quoted text")).toContain("<blockquote>");
});

test("renders tables", () => {
  const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
  expect(html).toContain("<table>");
  expect(html).toContain("<th>a</th>");
  expect(html).toContain("<td>1</td>");
});

test("renders horizontal rules", () => {
  expect(renderMarkdown("---")).toContain("<hr>");
});

test("renders images", () => {
  const html = renderMarkdown("![alt text](https://example.com/pic.png)");
  expect(html).toContain('src="https://example.com/pic.png"');
  expect(html).toContain('alt="alt text"');
});

test("external links carry rel=noopener noreferrer", () => {
  const html = renderMarkdown("[external](https://example.com)");
  expect(html).toContain('rel="noopener noreferrer"');
});

test("relative links do not carry rel attribute", () => {
  const html = renderMarkdown("[relative](/some/path)");
  expect(html).not.toContain("rel=");
});

test("empty and whitespace-only input do not throw", () => {
  expect(() => renderMarkdown("")).not.toThrow();
  expect(() => renderMarkdown("   \n\t  ")).not.toThrow();
  expect(renderMarkdown("")).toBe("");
});

test("SECURITY: script tags are neutralized", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  expect(html).not.toContain("<script");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("alert(1)");
});

test("SECURITY: img onerror handler is neutralized", () => {
  const html = renderMarkdown("<img src=x onerror=alert(1)>");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<img src=x onerror=alert(1)>");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
});

test("SECURITY: iframe, object, embed, and svg-with-onload tags are neutralized", () => {
  const iframe = renderMarkdown('<iframe src="evil"></iframe>');
  expect(iframe).not.toContain("<iframe");
  expect(iframe).toContain("&lt;iframe");

  const object = renderMarkdown('<object data="evil"></object>');
  expect(object).not.toContain("<object");
  expect(object).toContain("&lt;object");

  const embed = renderMarkdown('<embed src="evil">');
  expect(embed).not.toContain("<embed");
  expect(embed).toContain("&lt;embed");

  const svg = renderMarkdown("<svg onload=alert(1)></svg>");
  expect(svg).not.toContain("<svg onload=alert(1)>");
  expect(svg).toContain("&lt;svg onload=alert(1)&gt;");
});

test("SECURITY: javascript: link hrefs are neutralized, including case variants", () => {
  const lower = renderMarkdown("[click](javascript:alert(1))");
  expect(lower).not.toContain("javascript:");
  expect(lower).toContain('href="#"');
  expect(lower).toContain(">click</a>");

  const mixedCase = renderMarkdown("[click](JaVaScRiPt:alert(1))");
  expect(mixedCase).not.toContain("javascript:");
  expect(mixedCase).not.toContain("JaVaScRiPt:");
  expect(mixedCase).toContain('href="#"');
});

test("SECURITY: entity-encoded-whitespace-obfuscated javascript: hrefs are neutralized", () => {
  const html = renderMarkdown("[click](java&#9;script:alert(1))");
  expect(html.toLowerCase()).not.toContain("javascript:alert");
  expect(html).toContain('href="#"');
});

test("SECURITY: entity-obfuscated javascript: hrefs are neutralized", () => {
  const html = renderMarkdown("[click](java&#115;cript:alert(1))");
  expect(html.toLowerCase()).not.toContain("javascript:alert");
  expect(html).toContain('href="#"');
});

test("SECURITY: data: URIs in hrefs are neutralized", () => {
  const html = renderMarkdown(
    "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  );
  expect(html).not.toContain("data:text/html");
  expect(html).toContain('href="#"');
});

test("SECURITY: event-handler attributes in raw HTML do not reach output live", () => {
  const html = renderMarkdown('<div onclick="alert(1)">click me</div>');
  expect(html).not.toContain('<div onclick="alert(1)">');
  expect(html).toContain("&lt;div onclick=&quot;alert(1)&quot;&gt;");
});

test("SECURITY: markdown image syntax with a javascript: src is neutralized", () => {
  const html = renderMarkdown("![alt](javascript:alert(1))");
  expect(html).not.toContain("javascript:");
  expect(html).toContain('src="#"');
});

test("SECURITY: markdown image syntax with a data: src is neutralized", () => {
  const html = renderMarkdown("![alt](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)");
  expect(html).not.toContain("data:text/html");
  expect(html).toContain('src="#"');
});
