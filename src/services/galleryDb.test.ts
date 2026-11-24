import { beforeEach, describe, expect, it } from "vitest";
import {
  addGalleryFiles,
  clearMemoryGalleryForTests,
  deleteGallerySlide,
  isAnimatedImageMime,
  listGallerySlides,
} from "./galleryDb";

describe("galleryDb", () => {
  beforeEach(() => {
    clearMemoryGalleryForTests();
  });

  it("imports image and animated GIF files, ignores non-images, preserves order, and deletes by id", async () => {
    const png = new File(["png"], "cover.png", { type: "image/png" });
    const gif = new File(["GIF89a"], "loop.gif", { type: "image/gif" });
    const txt = new File(["hello"], "notes.txt", { type: "text/plain" });

    const added = await addGalleryFiles([png, txt, gif]);
    expect(added).toHaveLength(2);
    expect(added[0].name).toBe("cover.png");
    expect(isAnimatedImageMime(added[0].mimeType)).toBe(false);
    expect(added[1].name).toBe("loop.gif");
    expect(added[1].mimeType).toBe("image/gif");
    expect(isAnimatedImageMime(added[1].mimeType)).toBe(true);

    const listed = await listGallerySlides();
    expect(listed.map((s) => s.id)).toEqual(added.map((s) => s.id));

    await deleteGallerySlide(added[0].id);
    const remaining = await listGallerySlides();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(added[1].id);
  });
});
