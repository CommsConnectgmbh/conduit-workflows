// Measures every wrapped caption line with the real caption font in headless Chromium (same engine and system
// fonts as the Remotion renderer). The character estimate in layout.ts can be wrong for wide glyphs; a line that
// would overflow its caption box fails here, before anything is rendered.
import { chromium } from "playwright";
import { SpecError } from "../../src/spec/errors.ts";
import { CAPTION_FONT, CAPTION_WEIGHT, LINE_HEIGHT, captionDecorHeight } from "../../src/spec/layout.ts";
import type { ResolvedCut } from "../../src/spec/types.ts";

type Item = { path: string; lines: string[]; fontSize: number; maxWidth: number; maxHeight: number };

export const captionItems = (cuts: ResolvedCut[]): Item[] =>
  cuts.flatMap((cut) =>
    cut.scenes.map((s) => ({
      path: `$.cuts.${cut.cut}.scenes[${s.index}].caption`,
      lines: s.captionLines,
      fontSize: s.captionFontSize,
      maxWidth: s.captionBox.width,
      maxHeight: s.captionBox.height - captionDecorHeight(s.captionAlign, s.kind),
    })),
  );

export const measureCaptions = async (cuts: ResolvedCut[]): Promise<Array<{ path: string; widths: number[]; height: number }>> => {
  const items = captionItems(cuts);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 4000, height: 1000 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>`);
    return await page.evaluate(
      ({ items, font, weight, lineHeight }) =>
        items.map((it) => {
          const box = document.createElement("div");
          box.style.cssText = `position:absolute;left:0;top:0;display:inline-flex;flex-direction:column;font-family:${font};font-weight:${weight};font-size:${it.fontSize}px;line-height:${lineHeight}`;
          const widths = it.lines.map((l) => {
            const d = document.createElement("div");
            d.style.whiteSpace = "nowrap";
            d.style.width = "max-content";
            d.textContent = l;
            box.appendChild(d);
            return d;
          });
          document.body.appendChild(box);
          const res = { path: it.path, widths: widths.map((d) => d.getBoundingClientRect().width), height: box.getBoundingClientRect().height };
          box.remove();
          return res;
        }),
      { items, font: CAPTION_FONT, weight: CAPTION_WEIGHT, lineHeight: LINE_HEIGHT },
    );
  } finally {
    await browser.close();
  }
};

// Throws a SpecError listing every caption that does not fit its box with the real font.
export const assertCaptionsFit = async (cuts: ResolvedCut[]): Promise<void> => {
  const items = captionItems(cuts);
  const measured = await measureCaptions(cuts);
  const issues: string[] = [];
  measured.forEach((m, i) => {
    const it = items[i];
    m.widths.forEach((w, j) => {
      if (w > it.maxWidth) issues.push(`${m.path}: line ${j + 1} "${it.lines[j]}" is ${Math.ceil(w)}px wide, the caption box allows ${it.maxWidth}px`);
    });
    if (m.height > it.maxHeight) issues.push(`${m.path}: ${it.lines.length} line(s) are ${Math.ceil(m.height)}px high, the caption box allows ${it.maxHeight}px`);
  });
  if (issues.length) throw new SpecError(issues);
};
