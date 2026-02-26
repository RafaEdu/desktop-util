import { useEffect, useState, useCallback } from "react";
import {
  Circle,
  Plus,
  Trash2,
  ListTodo,
  Undo2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import dayjs from "dayjs";
import { cn } from "../lib/cn";
import { getDb, type Todo } from "../lib/db";

type SubTab = "active" | "history";

/** Parse a SQLite UTC datetime string into a local dayjs object. */
function formatTs(timestamp: string): string {
  // SQLite datetime('now') returns UTC without suffix — append 'Z' so dayjs
  // knows it's UTC and converts to local time for display.
  return dayjs(timestamp + "Z").format("DD/MM/YYYY [às] HH:mm");
}

export function Tasks() {
  const [subTab, setSubTab] = useState<SubTab>("active");
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);

  const loadTodos = useCallback(async () => {
    try {
      const db = await getDb();
      const query =
        subTab === "active"
          ? "SELECT * FROM todos WHERE done = 0 ORDER BY sort_order ASC"
          : "SELECT * FROM todos WHERE done = 1 ORDER BY completed_at DESC";
      console.log("[loadTodos] subTab:", subTab, "query:", query);
      const rows = await db.select<Todo[]>(query);
      console.log("[loadTodos] rows:", rows);
      setTodos(rows);
    } catch (err) {
      console.error("[loadTodos] FAILED:", err);
    } finally {
      setLoading(false);
    }
  }, [subTab]);

  useEffect(() => {
    setLoading(true);
    setTodos([]); // clear stale data from the other tab immediately
    loadTodos();
  }, [loadTodos]);

  const addTodo = async () => {
    const title = newTitle.trim();
    if (!title) return;
    console.log("[addTodo] starting, title:", title);
    try {
      const db = await getDb();
      console.log("[addTodo] db loaded");

      // Get next sort_order value
      const maxRow = await db.select<{ max_order: number | null }[]>(
        "SELECT MAX(sort_order) AS max_order FROM todos WHERE done = 0",
      );
      console.log("[addTodo] maxRow result:", maxRow);
      const nextOrder = (maxRow[0]?.max_order ?? 0) + 1;
      console.log("[addTodo] nextOrder:", nextOrder);

      const result = await db.execute(
        "INSERT INTO todos (title, sort_order) VALUES (?, ?)",
        [title, nextOrder],
      );
      console.log("[addTodo] insert result:", result);

      setNewTitle("");
      await loadTodos();
    } catch (err) {
      console.error("[addTodo] FAILED:", err);
    }
  };

  const toggleTodo = async (todo: Todo) => {
    try {
      const db = await getDb();
      if (Number(todo.done) === 1) {
        // Restore to active — assign to end of sort order
        const maxRow = await db.select<{ max_order: number | null }[]>(
          "SELECT MAX(sort_order) AS max_order FROM todos WHERE done = 0",
        );
        const nextOrder = (maxRow[0]?.max_order ?? 0) + 1;
        await db.execute(
          "UPDATE todos SET done = 0, completed_at = NULL, sort_order = ? WHERE id = ?",
          [nextOrder, todo.id],
        );
      } else {
        await db.execute(
          "UPDATE todos SET done = 1, completed_at = datetime('now') WHERE id = ?",
          [todo.id],
        );
      }
      await loadTodos();
    } catch (err) {
      console.error("Failed to toggle todo:", err);
    }
  };

  const deleteTodo = async (id: number) => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM todos WHERE id = ?", [id]);
      await loadTodos();
    } catch (err) {
      console.error("Failed to delete todo:", err);
    }
  };

  const moveTodo = async (index: number, direction: "up" | "down") => {
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= todos.length) return;

    const a = todos[index];
    const b = todos[swapIndex];

    try {
      const db = await getDb();
      // Swap sort_order values between the two items
      await db.execute("UPDATE todos SET sort_order = ? WHERE id = ?", [
        b.sort_order,
        a.id,
      ]);
      await db.execute("UPDATE todos SET sort_order = ? WHERE id = ?", [
        a.sort_order,
        b.id,
      ]);
      await loadTodos();
    } catch (err) {
      console.error("Failed to move todo:", err);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-tabs */}
      <div className="px-4 pt-3 pb-2 flex gap-2">
        <button
          onClick={() => setSubTab("active")}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            subTab === "active"
              ? "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30"
              : "text-fg-5 hover:text-fg-3 hover:bg-field",
          )}
        >
          Em Andamento
        </button>
        <button
          onClick={() => setSubTab("history")}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            subTab === "history"
              ? "bg-emerald-600/20 text-emerald-400 ring-1 ring-emerald-500/30"
              : "text-fg-5 hover:text-fg-3 hover:bg-field",
          )}
        >
          Histórico
        </button>
      </div>

      {/* Add Form — only in active tab */}
      {subTab === "active" && (
        <div className="px-4 pb-3 bg-surface/50 border-b border-edge">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTodo();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Adicionar nova tarefa..."
              className="flex-1 bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm
                         text-fg placeholder-fg-5
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                         transition-all duration-200"
            />
            <button
              type="submit"
              disabled={!newTitle.trim()}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                newTitle.trim()
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25"
                  : "bg-field text-fg-6 cursor-not-allowed",
              )}
            >
              <Plus className="w-4 h-4" />
              Adicionar
            </button>
          </form>
        </div>
      )}

      {/* Todo List */}
      <main className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : todos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-fg-6">
            <ListTodo className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">
              {subTab === "active"
                ? "Nenhuma tarefa em andamento."
                : "Nenhuma tarefa concluída."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {todos.map((todo, index) => (
              <li
                key={todo.id}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all duration-200",
                  Number(todo.done) === 1
                    ? "bg-surface/30 border-edge/50"
                    : "bg-surface border-edge hover:border-edge-2",
                )}
              >
                {/* Toggle Button */}
                <button
                  onClick={() => toggleTodo(todo)}
                  className="flex-shrink-0 transition-colors duration-200"
                  title={
                    Number(todo.done) === 1
                      ? "Restaurar tarefa"
                      : "Marcar como concluída"
                  }
                >
                  {Number(todo.done) === 1 ? (
                    <Undo2 className="w-4 h-4 text-fg-5 hover:text-indigo-400" />
                  ) : (
                    <Circle className="w-5 h-5 text-fg-6 hover:text-indigo-400" />
                  )}
                </button>

                {/* Task Text */}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm truncate transition-all duration-200",
                      Number(todo.done) === 1
                        ? "line-through text-fg-6"
                        : "text-fg-2",
                    )}
                  >
                    {todo.title}
                  </p>
                  <p className="text-xs text-fg-6 mt-0.5">
                    Criado em {formatTs(todo.created_at)}
                  </p>
                  {Number(todo.done) === 1 && todo.completed_at && (
                    <p className="text-xs text-emerald-600 mt-0.5">
                      Concluído em {formatTs(todo.completed_at)}
                    </p>
                  )}
                </div>

                {/* Reorder Buttons — only in active tab */}
                {subTab === "active" && (
                  <div className="flex flex-col gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button
                      onClick={() => moveTodo(index, "up")}
                      disabled={index === 0}
                      className={cn(
                        "p-0.5 rounded transition-colors",
                        index === 0
                          ? "text-fg-8 cursor-not-allowed"
                          : "text-fg-6 hover:text-indigo-400",
                      )}
                      title="Mover para cima"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => moveTodo(index, "down")}
                      disabled={index === todos.length - 1}
                      className={cn(
                        "p-0.5 rounded transition-colors",
                        index === todos.length - 1
                          ? "text-fg-8 cursor-not-allowed"
                          : "text-fg-6 hover:text-indigo-400",
                      )}
                      title="Mover para baixo"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Delete Button */}
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200
                             text-fg-6 hover:text-red-400"
                  title="Excluir tarefa"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
