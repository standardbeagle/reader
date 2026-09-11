import { describe, it, expect } from "vitest";
import { youtubeEmbedUrl, youtubeVideo } from "./youtube";

describe("youtubeVideo", () => {
  it("recognizes watch, youtu.be, Shorts and live links", () => {
    expect(youtubeVideo("https://www.youtube.com/watch?v=Od6M0AXpcxQ")).toEqual({ id: "Od6M0AXpcxQ", short: false });
    expect(youtubeVideo("https://m.youtube.com/watch?v=Od6M0AXpcxQ&t=30")).toEqual({ id: "Od6M0AXpcxQ", short: false });
    expect(youtubeVideo("https://youtu.be/Od6M0AXpcxQ")).toEqual({ id: "Od6M0AXpcxQ", short: false });
    expect(youtubeVideo("https://www.youtube.com/shorts/R6yNUnRXZ64")).toEqual({ id: "R6yNUnRXZ64", short: true });
    expect(youtubeVideo("https://www.youtube.com/live/Od6M0AXpcxQ")).toEqual({ id: "Od6M0AXpcxQ", short: false });
  });

  it("ignores other links and malformed ids", () => {
    expect(youtubeVideo("https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ")).toBeNull();
    expect(youtubeVideo("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youtubeVideo("https://notyoutube.com/watch?v=Od6M0AXpcxQ")).toBeNull();
    expect(youtubeVideo(null)).toBeNull();
    expect(youtubeVideo("not a url")).toBeNull();
  });

  it("builds a privacy-enhanced embed URL", () => {
    expect(youtubeEmbedUrl({ id: "Od6M0AXpcxQ", short: false })).toBe("https://www.youtube-nocookie.com/embed/Od6M0AXpcxQ?rel=0");
  });
});
