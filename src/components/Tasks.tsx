import { useEffect, useState, useCallback } from "react";
import { Circle, Plus, Trash2, ListTodo, Undo2 } from "lucide-react";
import dayjs from "dayjs";
import { cn } from "../lib/cn";
import { getDb, type Todo } from "../lib/db";

type SubTab = "active" | "history";

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
          ? "SELECT * FROM todos WHERE done = 0 ORDER BY created_at DESC"
          : "SELECT * FROM todos WHERE done = 1 ORDER BY completed_at DESC";
      const rows = await db.select<Todo[]>(query);
      setTodos(rows);
    } catch (err) {
      console.error("Failed to load todos:", err);
    } finally {
      setLoading(false);
    }
  }, [subTab]);

  useEffect(() => {
    setLoading(true);
    loadTodos();
  }, [loadTodos]);

  const addTodo = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const db = await getDb();
      await db.execute("INSERT INTO todos (title) VALUES (?)", [title]);
      setNewTitle("");
      await loadTodos();
    } catch (err) {
      console.error("Failed to add todo:", err);
    }
  };

  const toggleTodo = async (todo: Todo) => {
    try {
      const db = await getDb();
      if (todo.done) {
        await db.execute(
          "UPDATE todos SET done = 0, completed_at = NULL WHERE id = ?",
          [todo.id],
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
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800",
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
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800",
          )}
        >
          Histórico
        </button>
      </div>

      {/* Add Form — only in active tab */}
      {subTab === "active" && (
        <div className="px-4 pb-3 bg-gray-900/50 border-b border-gray-800">
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
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                         text-gray-100 placeholder-gray-500
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
                  : "bg-gray-800 text-gray-600 cursor-not-allowed",
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
          <div className="flex flex-col items-center justify-center h-32 text-gray-600">
            <ListTodo className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">
              {subTab === "active"
                ? "Nenhuma tarefa em andamento."
                : "Nenhuma tarefa concluída."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all duration-200",
                  todo.done
                    ? "bg-gray-900/30 border-gray-800/50"
                    : "bg-gray-900 border-gray-800 hover:border-gray-700",
                )}
              >
                {/* Toggle Button */}
                <button
                  onClick={() => toggleTodo(todo)}
                  className="flex-shrink-0 transition-colors duration-200"
                  title={
                    todo.done ? "Restaurar tarefa" : "Marcar como concluída"
                  }
                >
                  {todo.done ? (
                    <Undo2 className="w-4 h-4 text-gray-500 hover:text-indigo-400" />
                  ) : (
                    <Circle className="w-5 h-5 text-gray-600 hover:text-indigo-400" />
                  )}
                </button>

                {/* Task Text */}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm truncate transition-all duration-200",
                      todo.done
                        ? "line-through text-gray-600"
                        : "text-gray-200",
                    )}
                  >
                    {todo.title}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Criado em{" "}
                    {dayjs(todo.created_at).format("DD/MM/YYYY [às] HH:mm")}
                  </p>
                  {todo.done && todo.completed_at && (
                    <p className="text-xs text-emerald-600 mt-0.5">
                      Concluído em{" "}
                      {dayjs(todo.completed_at).format("DD/MM/YYYY [às] HH:mm")}
                    </p>
                  )}
                </div>

                {/* Delete Button */}
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200
                             text-gray-600 hover:text-red-400"
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
