// Add source: the kinds (YouTube import among them), then a private feed with OAuth sign-in.
import { act } from "./page.mjs";
export default async function run(d) {
  await act(d, `await __until(() => __q(".sidebar li > button")); __cursor(); await __wait(900);`);
  await act(d, `await __click(__q("button", "+ Add source")); await __until(() => __q(".source-kind"));`);
  d.mark("kinds");
  await d.sleep(1600);
  await act(d, `await __click(__q(".source-kind", "YouTube subscriptions"));`);
  d.mark("youtube");
  await d.sleep(3800);
  await act(d, `
    await __click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Back"));
    await __click(await __until(() => __q(".source-kind", "RSS / Atom feed")));
    await __type(await __until(() => document.getElementById("wiz-url")), "https://members.example.com/feed.xml");
    await __select(document.getElementById("wiz-feed-auth"), "oauth2");`);
  d.mark("oauth");
  await act(d, `
    await __type(await __until(() => document.getElementById("wiz-oauth-authorize")), "https://members.example.com/oauth/authorize");
    await __type(document.getElementById("wiz-oauth-token"), "https://members.example.com/oauth/token");
    await __type(document.getElementById("wiz-oauth-client"), "reader");
    await __glide(1000, 820);`);
  await d.sleep(2200);
  await act(d, `await __click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel"));`);
  await d.sleep(600);
}
