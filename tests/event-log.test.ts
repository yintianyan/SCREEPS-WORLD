import { describe, expect, it, beforeEach } from "vitest";
import {
  recordEvent,
  drainEventBuffer,
  EventKind,
  type GameEvent,
} from "../src/kernel/event-log";
import { createRingBuffer, ringPush, ringToArray, ringSize } from "../src/kernel/ring-buffer";

const mockGame = {
  time: 12345,
  cpu: { getUsed: () => 5, bucket: 8000, limit: 20, tickLimit: 20 },
};

beforeEach(() => {
  Object.assign(globalThis, { Game: mockGame });
  // Clear event buffer
  (globalThis as any).eventBuffer = { events: [] };
});

describe("Event Log — recordEvent", () => {
  it("records an event to heap buffer", () => {
    recordEvent(EventKind.PhaseTransition, "W1N1", [1, 2]);
    const events = drainEventBuffer();
    expect(events).toHaveLength(1);
    expect(events[0]!.k).toBe(EventKind.PhaseTransition);
    expect(events[0]!.r).toBe("W1N1");
    expect(events[0]!.d).toEqual([1, 2]);
    expect(events[0]!.t).toBe(12345);
  });

  it("records multiple events in order", () => {
    recordEvent(EventKind.TierDowngrade, "", [0, 1]);
    recordEvent(EventKind.EnemyInvasion, "W1N1", [3]);
    recordEvent(EventKind.P0SpawnRequest, "W1N1", [1]);

    const events = drainEventBuffer();
    expect(events).toHaveLength(3);
    expect(events[0]!.k).toBe(EventKind.TierDowngrade);
    expect(events[1]!.k).toBe(EventKind.EnemyInvasion);
    expect(events[2]!.k).toBe(EventKind.P0SpawnRequest);
  });

  it("drainEventBuffer clears the buffer", () => {
    recordEvent(EventKind.TierUpgrade, "", [3, 2]);
    const first = drainEventBuffer();
    expect(first).toHaveLength(1);

    const second = drainEventBuffer();
    expect(second).toHaveLength(0);
  });

  it("drainEventBuffer returns empty array when no events", () => {
    const events = drainEventBuffer();
    expect(events).toEqual([]);
  });

  it("handles events with empty data array", () => {
    recordEvent(EventKind.EnemyCleared, "W1N1", []);
    const events = drainEventBuffer();
    expect(events[0]!.d).toEqual([]);
  });

  it("handles global events with empty room name", () => {
    recordEvent(EventKind.TierDowngrade, "", [0, 1]);
    const events = drainEventBuffer();
    expect(events[0]!.r).toBe("");
  });
});

describe("Event Log — segment ring buffer integration", () => {
  it("events can be pushed to a ring buffer", () => {
    const buf = createRingBuffer<GameEvent>(3);
    ringPush(buf, { t: 1, k: 0, r: "W1N1", d: [1, 2] });
    ringPush(buf, { t: 2, k: 1, r: "", d: [0, 1] });
    ringPush(buf, { t: 3, k: 2, r: "W1N1", d: [] });

    expect(ringSize(buf)).toBe(3);
    const arr = ringToArray(buf);
    expect(arr[0]!.t).toBe(1);
    expect(arr[1]!.t).toBe(2);
    expect(arr[2]!.t).toBe(3);
  });

  it("ring buffer overwrites oldest events when full", () => {
    const buf = createRingBuffer<GameEvent>(2);
    ringPush(buf, { t: 1, k: 0, r: "", d: [] });
    ringPush(buf, { t: 2, k: 1, r: "", d: [] });
    ringPush(buf, { t: 3, k: 2, r: "", d: [] }); // overwrites t=1

    const arr = ringToArray(buf);
    expect(arr).toHaveLength(2);
    expect(arr[0]!.t).toBe(2);
    expect(arr[1]!.t).toBe(3);
  });

  it("survives JSON round-trip", () => {
    const buf = createRingBuffer<GameEvent>(3);
    ringPush(buf, { t: 100, k: EventKind.PhaseTransition, r: "W1N1", d: [1, 2] });
    ringPush(buf, { t: 200, k: EventKind.TierDowngrade, r: "", d: [0, 1] });

    const json = JSON.stringify({ events: buf });
    const restored = JSON.parse(json) as { events: import("../src/kernel/ring-buffer").RingBuffer<GameEvent> };
    const arr = ringToArray(restored.events);
    expect(arr).toHaveLength(2);
    expect(arr[0]!.k).toBe(EventKind.PhaseTransition);
    expect(arr[1]!.k).toBe(EventKind.TierDowngrade);
  });
});
