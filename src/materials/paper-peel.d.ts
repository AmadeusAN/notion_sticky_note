export {};

declare global {
  interface StickyPaperPeelController {
    setTarget(amount: number, pointerY: number): void;
    refresh(): void;
    destroy(): void;
  }

  interface Window {
    StickyPaperPeel: {
      create(host: HTMLElement, canvas: HTMLCanvasElement): StickyPaperPeelController;
    };
  }
}
