import { motion } from "framer-motion";
import type { Task } from "../types";
import { useTaskStore } from "../stores/taskStore";

interface Props {
  task: Task;
}

export function TaskItem({ task }: Props) {
  const toggleTask = useTaskStore((s) => s.toggleTask);

  return (
    <motion.div
      className={`task-item${task.completed ? " done" : ""}`}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <button
        type="button"
        className="task-check"
        data-checked={task.completed}
        aria-checked={task.completed}
        role="checkbox"
        onClick={() => void toggleTask(task.id)}
        aria-label={task.completed ? "标记未完成" : "标记完成"}
      />
      <div className="task-body">
        <p className="task-text">{task.title}</p>
        {(task.progress || task.remain || task.date || task.tags.length > 0) && (
          <div className="task-meta">
            {task.progress ? (
              <span className="meta-chip" data-kind="progress">
                {task.progress}
              </span>
            ) : null}
            {task.remain ? (
              <span className="meta-chip" data-kind="remain">
                {task.remain}
              </span>
            ) : null}
            {task.date ? (
              <span className="meta-chip" data-kind="date">
                {task.date}
              </span>
            ) : null}
            {task.tags.map((tag) => (
              <span className="meta-chip" data-kind="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
