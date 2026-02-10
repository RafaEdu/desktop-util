import { useState } from "react";
import { ListTodo, Timer as TimerIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { Tasks } from "./Tasks";
import { Timer } from "./Timer";

type ToolTab = "tasks" | "timer";

export function ToolsSection() {
  const [activeTab, setActiveTab] = useState<ToolTab>("tasks");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-tabs */}
      <div className="px-4 pt-3 pb-2 flex gap-2">
        <button
          onClick={() => setActiveTab("tasks")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            activeTab === "tasks"
              ? "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800",
          )}
        >
          <ListTodo className="w-3.5 h-3.5" />
          Tarefas
        </button>
        <button
          onClick={() => setActiveTab("timer")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            activeTab === "timer"
              ? "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800",
          )}
        >
          <TimerIcon className="w-3.5 h-3.5" />
          Timer
        </button>
      </div>

      {/* Content */}
      {activeTab === "tasks" ? <Tasks /> : <Timer />}
    </div>
  );
}
