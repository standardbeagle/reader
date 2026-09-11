// A Podcasting 2.0 episode: player, chapters, transcript; clicking either seeks.
import { act } from "./page.mjs";
export default async function run(d) {
  await act(d, `await __until(() => __q(".sidebar li > button")); __cursor(); await __wait(700);`);
  await act(d, `
    await __click(__q(".sidebar li > button", "Podcasting 2.0"));
    // Wait for the list to swap to the podcast before opening its newest episode.
    await __until(() => document.querySelector(".list li button")?.textContent.includes("Episode"));
    await __click(document.querySelector(".list li button"));
    await __until(() => document.querySelector(".episode-player"));`);
  d.mark("episode");
  await d.sleep(1500);
  await act(d, `await __click(__q(".episode-extra summary", "Chapters")); await __until(() => document.querySelector(".episode-chapters li"));`);
  await d.sleep(1200);
  await act(d, `await __click(document.querySelectorAll(".episode-chapters button")[4]);`);
  d.mark("chapter");
  await d.sleep(2200);
  await act(d, `
    await __click(__q(".episode-extra summary", "Chapters"));
    await __click(__q(".episode-extra summary", "Transcript"));
    await __until(() => document.querySelector(".episode-transcript li"));`);
  await d.sleep(1200);
  await act(d, `await __click(document.querySelectorAll(".episode-transcript button")[6]);`);
  d.mark("transcript");
  await d.sleep(2600);
  await act(d, `document.querySelector("audio")?.pause();`);
}
