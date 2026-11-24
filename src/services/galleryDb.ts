export interface GallerySlideRecord {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

const DB_NAME = "sticky_note_home_gallery";
const DB_VERSION = 1;
const STORE_NAME = "slides";

let memorySlides: GallerySlideRecord[] = [];

export function clearMemoryGalleryForTests(): void {
  memorySlides = [];
}

export function isAnimatedImageMime(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return normalized === "image/gif" || normalized === "image/webp";
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function makeSlideId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `slide-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function inferImageMime(file: File): string {
  if (file.type.startsWith("image/")) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "gif":
      return "image/gif";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    default:
      return "";
  }
}

function openGalleryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open gallery IndexedDB"));
  });
}

function sortSlides(slides: GallerySlideRecord[]): GallerySlideRecord[] {
  return [...slides].sort((a, b) => a.createdAt - b.createdAt);
}

export async function listGallerySlides(): Promise<GallerySlideRecord[]> {
  if (!hasIndexedDb()) {
    return sortSlides(memorySlides);
  }
  const db = await openGalleryDb();
  try {
    return await new Promise<GallerySlideRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(sortSlides((req.result as GallerySlideRecord[]) ?? []));
      req.onerror = () => reject(req.error ?? new Error("Failed to list gallery slides"));
    });
  } finally {
    db.close();
  }
}

export async function addGalleryFiles(files: readonly File[]): Promise<GallerySlideRecord[]> {
  const baseTs = Date.now();
  const candidates: GallerySlideRecord[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const mimeType = inferImageMime(file);
    if (!mimeType.startsWith("image/")) continue;
    candidates.push({
      id: makeSlideId(),
      name: file.name || `Image ${i + 1}`,
      mimeType,
      blob: file,
      createdAt: baseTs + i,
    });
  }
  if (candidates.length === 0) return [];

  if (!hasIndexedDb()) {
    memorySlides = [...memorySlides, ...candidates];
    return candidates;
  }

  const db = await openGalleryDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const slide of candidates) {
        store.put(slide);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to store gallery slides"));
    });
    return candidates;
  } finally {
    db.close();
  }
}

export async function deleteGallerySlide(id: string): Promise<void> {
  if (!hasIndexedDb()) {
    memorySlides = memorySlides.filter((s) => s.id !== id);
    return;
  }
  const db = await openGalleryDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to delete gallery slide"));
    });
  } finally {
    db.close();
  }
}
