// A YouTube channel feed (from a Takeout import) in the image-led pinboard view.
import { act } from "./page.mjs";
export default async function run(d) {
  await act(d, `await __until(() => __q(".sidebar li > button")); __cursor(); await __wait(600);`);
  await act(d, `
    const before = document.querySelector(".list li button")?.textContent;
    await __click(__q(".sidebar li > button", "Fireship"));
    await __until(() => document.querySelector(".list li button")?.textContent !== before);
    await __wait(700);
    await __click(document.querySelector("button.view-toggle"));
    await __until(() => { const imgs = [...document.querySelectorAll(".pin-card img")].slice(0, 4); return imgs.length && imgs.every((i) => i.complete); });`);
  d.mark("board");
  await d.sleep(1500);
  await act(d, `
    // Scroll the card grid's own scrolling container, whichever ancestor that is.
    let el = document.querySelector(".pin-card").parentElement;
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    el?.scrollBy({ top: 500, behavior: "smooth" });`);
  await d.sleep(1800);
  await act(d, `await __click(document.querySelector(".pin-card"));`);
  await d.sleep(2600);
}
