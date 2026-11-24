import { ARCHIVE_GROUP_ID, type Group, type Task } from "../types";
import { getTaskSpan } from "./calendarLayout";

export interface GraphNode {
  task: Task;
  x: number;
  y: number;
  color: string;
  groupName: string;
  radius: number;
  phaseX: number;
  phaseY: number;
  speedX: number;
  speedY: number;
  ampX: number;
  ampY: number;
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  color: string;
}

export interface UnscheduledGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_PALETTE = [
  "#f28b50",
  "#38bdf8",
  "#34d399",
  "#a78bfa",
  "#f472b6",
  "#facc15",
  "#2dd4bf",
  "#fb7185",
] as const;

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function pickNodeColor(groupId: string, index: number): string {
  const base = hashString(groupId) % NODE_PALETTE.length;
  return NODE_PALETTE[(base + (index % 2) * 3) % NODE_PALETTE.length];
}

export function buildUnscheduledGraph(
  tasks: readonly Task[],
  groups: readonly Group[],
  fallbackGroupLabel = "Local",
): UnscheduledGraph {
  const groupNameMap = new Map(groups.map((g) => [g.id, g.name]));
  const openUnscheduled = tasks.filter(
    (task) => !task.completed && task.groupId !== ARCHIVE_GROUP_ID && getTaskSpan(task) === null,
  );

  if (openUnscheduled.length === 0) {
    return { nodes: [], edges: [] };
  }

  const byGroup = new Map<string, Task[]>();
  for (const task of openUnscheduled) {
    const list = byGroup.get(task.groupId);
    if (list) list.push(task);
    else byGroup.set(task.groupId, [task]);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const groupKeys = [...byGroup.keys()];
  const groupCount = groupKeys.length;

  groupKeys.forEach((groupId, groupIdx) => {
    const bucket = byGroup.get(groupId)!;
    const anchorAngle = (groupIdx / Math.max(1, groupCount)) * Math.PI * 2 - Math.PI / 2;
    const clusterRadius = groupCount <= 1 ? 0 : 21;
    const cx = 50 + Math.cos(anchorAngle) * clusterRadius;
    const cy = 50 + Math.sin(anchorAngle) * (clusterRadius * 0.85);
    const groupName = groupNameMap.get(groupId) ?? fallbackGroupLabel;

    let prevNodeId: string | null = null;
    bucket.forEach((task, idx) => {
      const golden = idx * 2.399963229728653 + groupIdx * 0.9;
      const spread = idx === 0 && groupCount <= 1 ? 0 : 7.5 + Math.sqrt(idx + 1) * 7.2;
      const x = clamp(cx + Math.cos(golden) * spread, 11, 89);
      const y = clamp(cy + Math.sin(golden) * (spread * 0.84), 15, 85);
      const color = pickNodeColor(groupId, idx);
      const h = hashString(task.id);
      const phaseX = ((h & 0xff) / 255) * Math.PI * 2;
      const phaseY = (((h >>> 8) & 0xff) / 255) * Math.PI * 2;
      const speedX = 0.35 + (((h >>> 16) & 0xff) / 255) * 0.37;
      const speedY = 0.3 + (((h >>> 24) & 0xff) / 255) * 0.35;
      const ampX = 1.6 + (((h >>> 4) & 0x3f) / 63) * 1.6;
      const ampY = 1.6 + (((h >>> 12) & 0x3f) / 63) * 1.4;
      nodes.push({
        task,
        x,
        y,
        color,
        groupName,
        radius: Math.min(8.5, Math.max(5.5, 5.2 + Math.min(18, task.title.length) * 0.14)),
        phaseX,
        phaseY,
        speedX,
        speedY,
        ampX,
        ampY,
      });

      if (prevNodeId) {
        edges.push({
          id: `${prevNodeId}->${task.id}`,
          fromId: prevNodeId,
          toId: task.id,
          color,
        });
      }
      prevNodeId = task.id;
    });
  });

  // Deterministic repulsion passes so adjacent nodes always maintain readable breathing room.
  for (let pass = 0; pass < 24; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.001) {
          dx = 0.7;
          dy = 0.5;
          dist = Math.hypot(dx, dy);
        }
        const minDist = 13.5;
        if (dist < minDist) {
          const push = (minDist - dist) * 0.35;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x = clamp(a.x - ux * push, 10, 90);
          a.y = clamp(a.y - uy * push, 14, 86);
          b.x = clamp(b.x + ux * push, 10, 90);
          b.y = clamp(b.y + uy * push, 14, 86);
        }
      }
    }
  }

  return { nodes, edges };
}

export function sampleAnimatedNodePos(
  node: Pick<GraphNode, "x" | "y" | "phaseX" | "phaseY" | "speedX" | "speedY" | "ampX" | "ampY">,
  timeSec: number,
  ampScale = 1,
): { x: number; y: number } {
  return {
    x: clamp(node.x + Math.sin(timeSec * node.speedX + node.phaseX) * node.ampX * ampScale, 6, 94),
    y: clamp(node.y + Math.cos(timeSec * node.speedY + node.phaseY) * node.ampY * ampScale, 10, 90),
  };
}
