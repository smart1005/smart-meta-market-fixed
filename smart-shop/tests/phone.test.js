const { normalizeNgPhone } = require("../utils/phone");

describe("normalizeNgPhone", () => {
  test.each([
    ["08012345678", "2348012345678"],
    ["+2348012345678", "2348012345678"],
    ["2348012345678", "2348012345678"],
    ["0801 234 5678", "2348012345678"],
    ["0801-234-5678", "2348012345678"],
    ["8012345678", "2348012345678"],
    ["07012345678", "2347012345678"],
    ["09012345678", "2349012345678"],
  ])("%s -> %s (every format maps to the same number)", (input, expected) => {
    expect(normalizeNgPhone(input)).toBe(expected);
  });

  test.each([[""], [null], [undefined], ["12345"], ["0601234567"], ["080123456789"], ["abcdefghijk"]])(
    "rejects invalid number %p",
    (input) => {
      expect(normalizeNgPhone(input)).toBeNull();
    },
  );
});
