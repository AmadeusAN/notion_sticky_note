import { describe, expect, it } from "vitest";
import { ARCHIVE_GROUP_ID, type Group, type Task } from "../types";
import { buildUnscheduledGraph, sampleAnimatedNodePos } from "./taskGraph";

function makeTask(partial: Partial<Task> & Pick<Task, "id" | "title" | "groupId">): Task {
  return {
    notionId: null,
    completed: false,
    progress: null,
    remain: null,
    date: null,
    tags: [],
    updatedTime: 1000,
    ...partial,
  };
}

describe("taskGraph", () => {
  it("builds bounded colored constellation nodes and same-group edges for open unscheduled tasks only", () => {
    const groups: Group[] = [
      { id: "g1", name: "Focus", kind: "local", position: 0, createdAt: 1 },
      { id: "g2", name: "Reading", kind: "local", position: 1, createdAt: 2 },
    ];
    const tasks: Task[] = [
      makeTask({ id: "u1", title: "Alpha", groupId: "g1" }),
      makeTask({ id: "u2", title: "Beta", groupId: "g1" }),
      makeTask({ id: "u3", title: "Gamma", groupId: "g2" }),
      makeTask({ id: "scheduled", title: "Dated", groupId: "g1", startDate: "2026-11-24" }),
      makeTask({ id: "done", title: "Finished", groupId: "g1", completed: true }),
      makeTask({ id: "arch", title: "Archived", groupId: ARCHIVE_GROUP_ID }),
    ];

    const graph = buildUnscheduledGraph(tasks, groups);
    expect(graph.nodes.map((n) => n.task.id)).toEqual(["u1", "u2", "u3"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].fromId).toBe("u1");
    expect(graph.edges[0].toId).toBe("u2");

    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(10);
      expect(node.x).toBeLessThanOrEqual(90);
      expect(node.y).toBeGreaterThanOrEqual(14);
      expect(node.y).toBeLessThanOrEqual(86);
      expect(node.color).toMatch(/^#[0-9a-f]{6}$/i);

      const p0 = sampleAnimatedNodePos(node, 0);
      const p1 = sampleAnimatedNodePos(node, 2.5);
      expect(p0).not.toEqual(p1);
      expect(p1.x).toBeGreaterThanOrEqual(6);
      expect(p1.x).toBeLessThanOrEqual(94);
      expect(p1.y).toBeGreaterThanOrEqual(10);
      expect(p1.y).toBeLessThanOrEqual(90);
    }
  });
});
