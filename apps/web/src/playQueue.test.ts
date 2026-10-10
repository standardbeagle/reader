import { describe, expect, it } from "vitest";
import { EMPTY_QUEUE, currentItem, enqueue, isPlayable, jumpTo, playAll, playNow, removeAt, step, type PlayQueue, type QueueItem } from "./playQueue";

const item = (id: string): QueueItem => ({ id, feedId: "f1", title: id, url: null, media: { url: `https://cdn.example/${id}.mp3`, type: "audio/mpeg" }, imageUrl: null });
const ids = (queue: PlayQueue) => queue.items.map((i) => i.id);
const queueOf = (list: string[], index: number): PlayQueue => ({ items: list.map(item), index, position: 30, source: "Show" });

describe("play queue", () => {
  it("knows what can be played", () => {
    expect(isPlayable({ url: null, media: { url: "https://cdn.example/a.mp3" } })).toBe(true);
    expect(isPlayable({ url: "https://www.youtube.com/watch?v=abcdefghijk" })).toBe(true);
    expect(isPlayable({ url: "https://example.com/post", media: null })).toBe(false);
  });

  it("plays a new item right after the current one and jumps to one already queued", () => {
    const started = playNow(EMPTY_QUEUE, item("a"));
    expect([ids(started), started.index]).toEqual([["a"], 0]);
    const inserted = playNow(queueOf(["a", "b", "c"], 0), item("x"), 12);
    expect([ids(inserted), inserted.index, inserted.position, inserted.source]).toEqual([["a", "x", "b", "c"], 1, 12, null]);
    const jumped = playNow(queueOf(["a", "b", "c"], 0), item("c"));
    expect([ids(jumped), jumped.index, jumped.position]).toEqual([["a", "b", "c"], 2, 0]);
  });

  it("queues at the end without disturbing what is playing", () => {
    const queue = enqueue(queueOf(["a", "b"], 1), item("c"));
    expect([ids(queue), queue.index, queue.position]).toEqual([["a", "b", "c"], 1, 30]);
    expect(enqueue(queue, item("a"))).toBe(queue);
    expect(currentItem(enqueue(EMPTY_QUEUE, item("a")))?.id).toBe("a");
  });

  it("starts a stream at the chosen item, or the top", () => {
    const stream = ["a", "b", "c"].map(item);
    expect(playAll(stream, "Tech").index).toBe(0);
    expect(playAll(stream, "Tech", "b")).toMatchObject({ index: 1, source: "Tech", position: 0 });
    expect(playAll(stream, "Tech", "missing").index).toBe(0);
    expect(playAll([], "Tech")).toBe(EMPTY_QUEUE);
  });

  it("steps and jumps within bounds only", () => {
    const queue = queueOf(["a", "b"], 0);
    expect(step(queue, 1)).toMatchObject({ index: 1, position: 0 });
    expect(step(queue, -1)).toBeNull();
    expect(step(queueOf(["a", "b"], 1), 1)).toBeNull();
    expect(jumpTo(queue, 1).index).toBe(1);
    expect(jumpTo(queue, 5)).toBe(queue);
  });

  it("removes items, keeping the current one current when it can", () => {
    const queue = queueOf(["a", "b", "c"], 1);
    const before = removeAt(queue, 0);
    expect([ids(before), currentItem(before)?.id, before.position]).toEqual([["b", "c"], "b", 30]);
    const after = removeAt(queue, 2);
    expect([ids(after), currentItem(after)?.id]).toEqual([["a", "b"], "b"]);
    const current = removeAt(queue, 1);
    expect([ids(current), currentItem(current)?.id, current.position]).toEqual([["a", "c"], "c", 0]);
    expect(currentItem(removeAt(queueOf(["a", "b"], 1), 1))?.id).toBe("a");
    expect(removeAt(queueOf(["a"], 0), 0)).toBe(EMPTY_QUEUE);
  });
});
