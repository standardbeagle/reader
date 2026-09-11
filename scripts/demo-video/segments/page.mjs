// Page-side helpers for demo segments. Steps run inside the page, so a click
// is the page's own el.click() and the cursor is drawn: headless recordings
// have none, and it glides with a CSS transition rather than synthetic mouse
// moves.
export const PAGE_HELPERS = `
  const GLIDE_MS = 450;
  const __q = (sel, text) => [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.includes(text));
  const __until = (fn, ms = 15000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => { let v; try { v = fn(); } catch {} if (v) resolve(v); else if (Date.now() - t0 > ms) reject(new Error("timed out: " + fn)); else setTimeout(tick, 100); };
    tick();
  });
  const __wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const __cursor = () => {
    let dot = document.getElementById("demo-cursor");
    if (!dot) {
      dot = document.createElement("div");
      dot.id = "demo-cursor";
      Object.assign(dot.style, {
        position: "fixed", left: "720px", top: "450px", width: "22px", height: "22px", zIndex: "2147483647",
        borderRadius: "50%", background: "rgba(79,70,229,0.35)", border: "2px solid #4f46e5",
        transform: "translate(-50%,-50%)", pointerEvents: "none",
        transition: "left " + GLIDE_MS + "ms ease, top " + GLIDE_MS + "ms ease, width .12s, height .12s",
      });
      document.body.appendChild(dot);
    }
    return dot;
  };
  const __glide = async (x, y) => { const dot = __cursor(); dot.style.left = x + "px"; dot.style.top = y + "px"; await __wait(GLIDE_MS + 60); };
  const __click = async (el) => {
    if (!el) throw new Error("click: no element");
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    await __glide(r.left + r.width / 2, r.top + r.height / 2);
    await __wait(220);
    const dot = __cursor(); dot.style.width = dot.style.height = "14px";
    setTimeout(() => { dot.style.width = dot.style.height = "22px"; }, 160);
    if (el.tagName === "SUMMARY") el.parentElement.open = !el.parentElement.open; else el.click();
  };
  const __setValue = (el, v) => {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };
  const __type = async (el, text) => {
    await __click(el);
    for (let i = 1; i <= text.length; i++) { __setValue(el, text.slice(0, i)); await __wait(35); }
  };
  const __select = async (el, value) => { await __click(el); await __wait(250); __setValue(el, value); };`;

/** Run page-side steps (with the helpers above in scope) in the segment's page. */
export async function act(d, js) {
  return d.page.evaluate(`(async () => { ${PAGE_HELPERS}\n${js} })()`);
}
