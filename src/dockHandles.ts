export type DockHandleId = "capsule" | "paper" | "grip";

export const DEFAULT_DOCK_HANDLE: DockHandleId = "grip";

export const dockHandles: Record<
  DockHandleId,
  { id: DockHandleId; label: string; hint: string }
> = {
  capsule: {
    id: "capsule",
    label: "胶囊",
    hint: "贴边侧短胶囊，强调色实心",
  },
  paper: {
    id: "paper",
    label: "纸感",
    hint: "面板底色短胶囊，描边带一点强调色",
  },
  grip: {
    id: "grip",
    label: "凹槽",
    hint: "面板底色短胶囊 + 中间细凹槽纹",
  },
};

export const dockHandleIds = Object.keys(dockHandles) as DockHandleId[];

export function normalizeDockHandleId(
  value: string | undefined | null,
  fallback: DockHandleId = DEFAULT_DOCK_HANDLE,
): DockHandleId {
  if (value && value in dockHandles) return value as DockHandleId;
  return fallback;
}
