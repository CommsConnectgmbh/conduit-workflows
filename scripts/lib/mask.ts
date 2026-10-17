// Runs inside the page before any app script and hides matching content before it is painted.
// Redaction is opaque: masked elements get visibility:hidden (layout stays, no text pixels are painted) and an
// opaque box is drawn over them. There is deliberately no blur. Limits: only DOM text, input values and the
// configured selectors are covered; pixels inside images, canvas, video, cross-origin iframes and closed shadow
// roots are not matched, so every recording still needs a visual check before it is shared.
export const BUILTIN_PATTERNS = [
  "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", // e-mail
  "\\b[A-Z]{2}\\d{2}(?:\\s?[A-Z0-9]{4}){3,7}(?:\\s?[A-Z0-9]{1,4})?\\b", // IBAN
  "\\bDE\\s?\\d{9}\\b", // VAT ID
  "(?:\\+|\\b00|\\b0)\\d[\\d\\s/()-]{5,}\\d", // phone-like (starts with +, 00 or 0), filtered to >= 7 digits
];

export type MaskConfig = { selectors: string[]; patterns: string[]; css: string };

// :is() keeps comma lists in one selector intact; the descendant and pseudo-element rules hide nested content too.
export const maskCss = (selectors: string[]): string => {
  const target = [`[data-cvp-mask]`, ...selectors.map((s) => `:is(${s})`)].join(",");
  const hide = [`:is(${target})`, `:is(${target}) *`, `:is(${target})::before`, `:is(${target})::after`, `:is(${target})::placeholder`];
  // One rule per selector: an unsupported pseudo-element must not invalidate the main rule.
  return `${hide.map((h) => `${h}{visibility:hidden!important}`).join("")}#cvp-mask-overlay{position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;visibility:visible!important;display:block!important}#cvp-mask-overlay>div{position:fixed!important;background:#1f2937!important;border-radius:3px!important;visibility:visible!important;display:block!important}`;
};

export const maskConfig = (selectors: string[], patterns: string[]): MaskConfig => ({ selectors, patterns, css: maskCss(selectors) });

// Passed to addInitScript, so it must stay self-contained (no references to module scope).
export function installMask(cfg: MaskConfig) {
  if (typeof cfg.css !== "string" || !cfg.css.includes("visibility:hidden")) throw new Error("mask: css missing, build the config with maskConfig()");
  const res = cfg.patterns.map((p) => new RegExp(p, "g"));
  const hit = (text: string) =>
    res.some((re) => {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        // Phone-like pattern needs enough digits to avoid masking dates and amounts.
        if (re.source.startsWith("(?:\\+|") && m[0].replace(/\D/g, "").length < 7) continue;
        return true;
      }
      return false;
    });
  const badSelectors = cfg.selectors.filter((s) => {
    try {
      document.createDocumentFragment().querySelector(s);
      return false;
    } catch {
      return true;
    }
  });
  const targets = ["[data-cvp-mask]", ...cfg.selectors.filter((s) => !badSelectors.includes(s))].join(",");
  const addStyle = () => {
    if (document.getElementById("cvp-mask-style")) return;
    const st = document.createElement("style");
    st.id = "cvp-mask-style";
    st.textContent = cfg.css;
    (document.head || document.documentElement).appendChild(st);
  };
  // Opaque boxes over masked elements. Cosmetic only: the content underneath is already invisible.
  const boxes: HTMLDivElement[] = [];
  const drawOverlay = () => {
    let layer = document.getElementById("cvp-mask-overlay");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "cvp-mask-overlay";
      layer.setAttribute("aria-hidden", "true");
      document.documentElement.appendChild(layer);
    }
    let used = 0;
    for (const el of Array.from(document.querySelectorAll(targets))) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      let b = boxes[used];
      if (!b) {
        b = document.createElement("div");
        boxes.push(b);
      }
      if (b.parentNode !== layer) layer.appendChild(b);
      b.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      used++;
    }
    for (const b of boxes.slice(used)) b.remove();
  };
  const scan = (root: Node) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (el && !el.hasAttribute("data-cvp-mask") && hit(n.textContent || "")) el.setAttribute("data-cvp-mask", "");
    }
  };
  const scanInputs = () => {
    for (const el of Array.from(document.querySelectorAll("input,textarea")) as Array<HTMLInputElement>) {
      const masked = el.hasAttribute("data-cvp-mask");
      const h = hit(el.value || "") || hit(el.placeholder || "");
      if (h && !masked) el.setAttribute("data-cvp-mask", "");
    }
  };
  new MutationObserver((muts) => {
    addStyle();
    for (const m of muts) {
      if (m.type === "characterData" && m.target.parentElement) scan(m.target.parentElement);
      for (const n of Array.from(m.addedNodes)) scan(n);
    }
    scanInputs();
  }).observe(document, { subtree: true, childList: true, characterData: true });
  // Input values change without DOM mutations; check them right before every paint.
  const loop = () => {
    scanInputs();
    drawOverlay();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // Counts sensitive content that would still be painted, e.g. because app CSS forces visibility back on.
  (window as unknown as { __cvpUnmasked: () => number }).__cvpUnmasked = () => {
    if (badSelectors.length) throw new Error(`mask: invalid selector(s): ${badSelectors.join(" | ")}`);
    addStyle();
    scan(document.documentElement);
    scanInputs();
    const shown = (el: Element) => getComputedStyle(el).visibility !== "hidden";
    let open = 0;
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest("style,script,#cvp-mask-overlay")) continue;
      if (hit(n.textContent || "") && shown(el)) open++;
    }
    for (const el of Array.from(document.querySelectorAll("input,textarea")) as Array<HTMLInputElement>) {
      if ((hit(el.value || "") || hit(el.placeholder || "")) && shown(el)) open++;
    }
    for (const el of Array.from(document.querySelectorAll(targets))) if (shown(el)) open++;
    return open;
  };
}
