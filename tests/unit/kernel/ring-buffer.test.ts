import { describe, expect, it } from "vitest";
import {
  createRingBuffer,
  ringPush,
  ringToArray,
  ringSize,
  ringClear,
} from "../../../src/kernel/ring-buffer";

describe("RingBuffer — 基础操作", () => {
  it("creates empty buffer with correct capacity", () => {
    const buf = createRingBuffer<number>(5);
    expect(ringSize(buf)).toBe(0);
    expect(ringToArray(buf)).toEqual([]);
  });

  it("pushes and retrieves elements in order", () => {
    const buf = createRingBuffer<number>(5);
    ringPush(buf, 10);
    ringPush(buf, 20);
    ringPush(buf, 30);
    expect(ringSize(buf)).toBe(3);
    expect(ringToArray(buf)).toEqual([10, 20, 30]);
  });

  it("overwrites oldest data when full", () => {
    const buf = createRingBuffer<number>(3);
    ringPush(buf, 1);
    ringPush(buf, 2);
    ringPush(buf, 3);
    ringPush(buf, 4); // overwrites 1
    expect(ringSize(buf)).toBe(3);
    expect(ringToArray(buf)).toEqual([2, 3, 4]);
  });

  it("handles multiple wraps correctly", () => {
    const buf = createRingBuffer<number>(3);
    for (let i = 1; i <= 10; i++) ringPush(buf, i);
    expect(ringSize(buf)).toBe(3);
    expect(ringToArray(buf)).toEqual([8, 9, 10]);
  });

  it("clears buffer while preserving capacity", () => {
    const buf = createRingBuffer<number>(5);
    ringPush(buf, 1);
    ringPush(buf, 2);
    ringClear(buf);
    expect(ringSize(buf)).toBe(0);
    expect(ringToArray(buf)).toEqual([]);
    // Still functional after clear
    ringPush(buf, 99);
    expect(ringToArray(buf)).toEqual([99]);
  });

  it("handles string elements", () => {
    const buf = createRingBuffer<string>(3);
    ringPush(buf, "a");
    ringPush(buf, "b");
    ringPush(buf, "c");
    ringPush(buf, "d"); // overwrites "a"
    expect(ringToArray(buf)).toEqual(["b", "c", "d"]);
  });

  it("handles object elements", () => {
    const buf = createRingBuffer<{ x: number }>(2);
    ringPush(buf, { x: 1 });
    ringPush(buf, { x: 2 });
    ringPush(buf, { x: 3 }); // overwrites first
    const arr = ringToArray(buf);
    expect(arr).toHaveLength(2);
    expect(arr[0]!.x).toBe(2);
    expect(arr[1]!.x).toBe(3);
  });

  it("survives JSON round-trip (serialization)", () => {
    const buf = createRingBuffer<number>(5);
    ringPush(buf, 1);
    ringPush(buf, 2);
    ringPush(buf, 3);

    const json = JSON.stringify(buf);
    const restored = JSON.parse(json) as typeof buf;
    expect(ringToArray(restored)).toEqual([1, 2, 3]);
    expect(ringSize(restored)).toBe(3);
  });

  it("survives JSON round-trip after wrap", () => {
    const buf = createRingBuffer<number>(3);
    for (let i = 1; i <= 7; i++) ringPush(buf, i);

    const json = JSON.stringify(buf);
    const restored = JSON.parse(json) as typeof buf;
    expect(ringToArray(restored)).toEqual([5, 6, 7]);
  });
});
