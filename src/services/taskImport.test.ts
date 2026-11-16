import { expect, it } from "vitest";
import { splitTaskText } from "./taskImport";

it("splits only Chinese and ASCII semicolons, preserving commas, inner newlines, order and duplicates", () => {
  expect(splitTaskText("甲，乙；丙\n丁;甲，乙;;")).toEqual(["甲，乙", "丙\n丁", "甲，乙"]);
});

it("discards blank segments and trims boundaries without splitting paragraph content", () => {
  expect(splitTaskText("  ;； \n ; 第一行\n第二行，保留 ;  最后 ；")).toEqual(["第一行\n第二行，保留", "最后"]);
  expect(splitTaskText("\n ;； ; \t")).toEqual([]);
});
