// Labelled contact sheet rendered with headless Chromium (the local ffmpeg build has no drawtext).
import fs from "node:fs";
import { chromium } from "playwright";

export type SheetItem = { image: string; label: string; sublabel?: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const contactSheet = async (items: SheetItem[], out: string, opts: { columns: number; thumbWidth: number; title: string }) => {
  if (items.length === 0) throw new Error("contact sheet needs at least one image");
  const cells = items
    .map((it) => {
      if (!fs.existsSync(it.image)) throw new Error(`contact sheet image missing: ${it.image}`);
      const data = fs.readFileSync(it.image).toString("base64");
      return `<figure><img src="data:image/png;base64,${data}"><figcaption><b>${esc(it.label)}</b>${it.sublabel ? `<span>${esc(it.sublabel)}</span>` : ""}</figcaption></figure>`;
    })
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:#1f2328;color:#e6edf3;font:14px -apple-system,Helvetica,Arial,sans-serif}
    h1{font-size:18px;margin:0 0 16px}
    main{display:grid;grid-template-columns:repeat(${opts.columns},${opts.thumbWidth}px);gap:16px}
    figure{margin:0}img{width:${opts.thumbWidth}px;display:block;border:1px solid #444}
    figcaption{padding-top:6px;display:flex;flex-direction:column;gap:2px}span{color:#9da7b1}
  </style></head><body><h1>${esc(opts.title)}</h1><main>${cells}</main></body></html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: opts.columns * (opts.thumbWidth + 16) + 32, height: 400 } });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: out, fullPage: true });
  } finally {
    await browser.close();
  }
};
