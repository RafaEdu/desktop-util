import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Bell,
  BellOff,
  Timer as TimerIcon,
  ChevronLeft,
  Flag,
  Clock,
  Hourglass,
  Trash2,
} from "lucide-react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "../lib/cn";
import { showWindowAboveTray } from "../lib/window";

// ── Helpers ──────────────────────────────────────────────────────
function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
  return `${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

type View = "stopwatch" | "countdown";
type CountdownInputMode = "duration" | "time";

// ═════════════════════════════════════════════════════════════════
// Stopwatch Sub-component
// ═════════════════════════════════════════════════════════════════
function Stopwatch() {
  const [elapsed, setElapsed] = useState(0); // milliseconds
  const [isRunning, setIsRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]); // elapsed ms at each lap
  const startRef = useRef(0); // Date.now() when started
  const accRef = useRef(0); // accumulated ms before current run

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      setElapsed(accRef.current + (Date.now() - startRef.current));
    }, 37); // ~27fps for smooth centiseconds
    return () => clearInterval(id);
  }, [isRunning]);

  const handleStart = () => {
    startRef.current = Date.now();
    setIsRunning(true);
  };

  const handlePause = () => {
    accRef.current += Date.now() - startRef.current;
    setIsRunning(false);
  };

  const handleReset = () => {
    setIsRunning(false);
    setElapsed(0);
    accRef.current = 0;
    setLaps([]);
  };

  const handleLap = () => {
    setLaps((prev) => [...prev, elapsed]);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Display */}
      <div className="flex items-center justify-center py-8">
        <span className="text-5xl font-mono font-bold text-gray-100 tabular-nums tracking-tight">
          {formatElapsed(elapsed)}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 mb-4">
        {!isRunning ? (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium
                       bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 transition-all duration-200"
          >
            <Play className="w-4 h-4" />
            {elapsed > 0 ? "Continuar" : "Iniciar"}
          </button>
        ) : (
          <button
            onClick={handlePause}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium
                       bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/25 transition-all duration-200"
          >
            <Pause className="w-4 h-4" />
            Pausar
          </button>
        )}

        {isRunning && (
          <button
            onClick={handleLap}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
                       bg-gray-800 hover:bg-gray-700 text-gray-300 transition-all duration-200"
          >
            <Flag className="w-4 h-4" />
            Volta
          </button>
        )}

        {(elapsed > 0 || laps.length > 0) && !isRunning && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
                       bg-gray-800 hover:bg-gray-700 text-gray-300 transition-all duration-200"
          >
            <RotateCcw className="w-4 h-4" />
            Resetar
          </button>
        )}
      </div>

      {/* Laps */}
      {laps.length > 0 && (
        <div className="flex-1 overflow-y-auto px-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500 font-medium">
              Voltas ({laps.length})
            </p>
            <button
              onClick={() => setLaps([])}
              className="text-gray-600 hover:text-red-400 transition-colors"
              title="Limpar voltas"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="space-y-1">
            {[...laps].reverse().map((lapMs, i) => {
              const lapNum = laps.length - i;
              const prevMs = lapNum >= 2 ? laps[lapNum - 2] : 0;
              const diff = lapMs - prevMs;
              return (
                <li
                  key={i}
                  className="flex items-center justify-between px-3 py-1.5 rounded-md bg-gray-900 border border-gray-800 text-sm"
                >
                  <span className="text-gray-500 text-xs font-medium">
                    #{pad2(lapNum)}
                  </span>
                  <span className="text-gray-400 font-mono text-xs">
                    +{formatElapsed(diff)}
                  </span>
                  <span className="text-gray-200 font-mono">
                    {formatElapsed(lapMs)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Countdown Sub-component
// ═════════════════════════════════════════════════════════════════
function Countdown({ onBack }: { onBack: () => void }) {
  // Input mode
  const [inputMode, setInputMode] = useState<CountdownInputMode>("duration");

  // Duration mode state
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);

  // Time mode state
  const [targetTime, setTargetTime] = useState("");

  // Shared state
  const [alertName, setAlertName] = useState("");
  const [silentMode, setSilentMode] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [finished, setFinished] = useState(false);
  const [totalDuration, setTotalDuration] = useState(0);

  // Ref to guard against double-fire (React StrictMode)
  const finishedRef = useRef(false);
  const silentRef = useRef(silentMode);
  const alertNameRef = useRef(alertName);
  useEffect(() => {
    silentRef.current = silentMode;
  }, [silentMode]);
  useEffect(() => {
    alertNameRef.current = alertName;
  }, [alertName]);

  const handleStart = () => {
    let total: number;

    if (inputMode === "time") {
      if (!targetTime) return;
      const [h, m] = targetTime.split(":").map(Number);
      const now = new Date();
      const target = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        h,
        m,
        0,
      );
      // If target is in the past, schedule for tomorrow
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      total = Math.ceil((target.getTime() - now.getTime()) / 1000);
    } else {
      total = minutes * 60 + seconds;
    }

    if (total <= 0) return;
    setTotalDuration(total);
    setRemaining(total);
    setFinished(false);
    finishedRef.current = false;
    setIsRunning(true);
  };

  const handleStop = () => {
    setIsRunning(false);
  };

  const handleReset = () => {
    setIsRunning(false);
    setRemaining(0);
    setTotalDuration(0);
    setFinished(false);
    finishedRef.current = false;
  };

  // Finish handler — guarded against double calls
  const onTimerFinish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinished(true);

    if (silentRef.current) {
      // Silent ON → system notification only (quiet)
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === "granted";
      }
      if (granted) {
        sendNotification({
          title: alertNameRef.current || "Timer",
          body: "Tempo esgotado!",
        });
      }
    } else {
      // Silent OFF → force window open/focus (intrusive alert)
      const win = getCurrentWindow();
      await showWindowAboveTray();
      await win.setFocus();
    }
  }, []);

  // Timer tick
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          onTimerFinish();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning, onTimerFinish]);

  // Format remaining as MM:SS or HH:MM:SS
  const rHours = Math.floor(remaining / 3600);
  const rMin = Math.floor((remaining % 3600) / 60);
  const rSec = remaining % 60;
  const displayTime =
    rHours > 0
      ? `${pad2(rHours)}:${pad2(rMin)}:${pad2(rSec)}`
      : `${pad2(rMin)}:${pad2(rSec)}`;

  // Progress ring
  const progress =
    totalDuration > 0 && (isRunning || finished)
      ? ((totalDuration - remaining) / totalDuration) * 100
      : 0;

  const canStart =
    inputMode === "duration" ? minutes * 60 + seconds > 0 : !!targetTime;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Back button */}
      <button
        onClick={onBack}
        disabled={isRunning}
        className={cn(
          "flex items-center gap-1 px-3 py-1.5 text-xs transition-colors mb-2",
          isRunning
            ? "text-gray-700 cursor-not-allowed"
            : "text-gray-500 hover:text-gray-300",
        )}
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Voltar ao Cronômetro
      </button>

      {/* Alert Name */}
      <div className="px-4 mb-3">
        <label className="block text-xs text-gray-500 mb-1">
          Nome do Alerta
        </label>
        <input
          type="text"
          value={alertName}
          onChange={(e) => setAlertName(e.target.value)}
          placeholder="Ex: Reunião, Pausa..."
          disabled={isRunning}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                     text-gray-100 placeholder-gray-500
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                     disabled:opacity-50 transition-all duration-200"
        />
      </div>

      {/* Input mode toggle */}
      <div className="px-4 mb-3 flex gap-2">
        <button
          onClick={() => setInputMode("duration")}
          disabled={isRunning}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            inputMode === "duration"
              ? "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800",
            isRunning && "opacity-50 cursor-not-allowed",
          )}
        >
          <Hourglass className="w-3.5 h-3.5" />
          Duração
        </button>
        <button
          onClick={() => setInputMode("time")}
          disabled={isRunning}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            inputMode === "time"
              ? "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800",
            isRunning && "opacity-50 cursor-not-allowed",
          )}
        >
          <Clock className="w-3.5 h-3.5" />
          Horário
        </button>
      </div>

      {/* Input fields */}
      <div className="px-4 mb-3">
        {inputMode === "duration" ? (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">
                Minutos
              </label>
              <input
                type="number"
                min={0}
                max={999}
                value={minutes}
                onChange={(e) =>
                  setMinutes(Math.max(0, parseInt(e.target.value) || 0))
                }
                disabled={isRunning}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-center
                           text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                           disabled:opacity-50 transition-all duration-200"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">
                Segundos
              </label>
              <input
                type="number"
                min={0}
                max={59}
                value={seconds}
                onChange={(e) =>
                  setSeconds(
                    Math.max(0, Math.min(59, parseInt(e.target.value) || 0)),
                  )
                }
                disabled={isRunning}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-center
                           text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                           disabled:opacity-50 transition-all duration-200"
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Alertar às
            </label>
            <input
              type="time"
              value={targetTime}
              onChange={(e) => setTargetTime(e.target.value)}
              disabled={isRunning}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                         text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                         disabled:opacity-50 transition-all duration-200"
            />
            <p className="text-xs text-gray-600 mt-1">
              Se o horário já passou hoje, será agendado para amanhã.
            </p>
          </div>
        )}
      </div>

      {/* Silent mode toggle */}
      <div className="px-4 mb-4">
        <button
          onClick={() => setSilentMode(!silentMode)}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200 w-full justify-center",
            silentMode
              ? "bg-amber-600/20 text-amber-400 ring-1 ring-amber-500/30"
              : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700",
          )}
        >
          {silentMode ? (
            <BellOff className="w-4 h-4" />
          ) : (
            <Bell className="w-4 h-4" />
          )}
          {silentMode ? "Silencioso (notificação)" : "Abrir janela ao terminar"}
        </button>
      </div>

      {/* Countdown display */}
      <div className="flex items-center justify-center mb-4">
        <div className="relative flex items-center justify-center w-36 h-36">
          <svg
            className="absolute w-full h-full -rotate-90"
            viewBox="0 0 100 100"
          >
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-gray-800"
            />
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${2 * Math.PI * 45}`}
              strokeDashoffset={`${2 * Math.PI * 45 * (1 - progress / 100)}`}
              strokeLinecap="round"
              className={cn(
                "transition-all duration-1000",
                finished ? "text-emerald-500" : "text-indigo-500",
              )}
            />
          </svg>
          <span className="text-3xl font-mono font-bold text-gray-100 tabular-nums">
            {displayTime}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        {!isRunning ? (
          <button
            onClick={handleStart}
            disabled={!canStart || finished}
            className={cn(
              "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              canStart && !finished
                ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25"
                : "bg-gray-800 text-gray-600 cursor-not-allowed",
            )}
          >
            <Play className="w-4 h-4" />
            Iniciar
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium
                       bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-500/25 transition-all duration-200"
          >
            <Square className="w-4 h-4" />
            Parar
          </button>
        )}
        <button
          onClick={handleReset}
          disabled={remaining === 0 && !isRunning && !finished}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
            remaining > 0 || isRunning || finished
              ? "bg-gray-800 hover:bg-gray-700 text-gray-300"
              : "bg-gray-800 text-gray-600 cursor-not-allowed",
          )}
        >
          <RotateCcw className="w-4 h-4" />
          Resetar
        </button>
      </div>

      {/* Finished message */}
      {finished && (
        <div className="mt-3 text-center">
          <p className="text-sm text-emerald-400 font-medium">
            {alertName
              ? `"${alertName}" — Tempo esgotado!`
              : "Tempo esgotado!"}
          </p>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Main Timer Export
// ═════════════════════════════════════════════════════════════════
export function Timer() {
  const [view, setView] = useState<View>("stopwatch");

  return (
    <div className="flex-1 flex flex-col overflow-hidden px-4 py-3">
      {view === "stopwatch" ? (
        <>
          <Stopwatch />
          <div className="pt-3 border-t border-gray-800 mt-auto">
            <button
              onClick={() => setView("countdown")}
              className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg text-sm font-medium
                         bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-all duration-200"
            >
              <TimerIcon className="w-4 h-4" />
              Contagem Regressiva
            </button>
          </div>
        </>
      ) : (
        <Countdown onBack={() => setView("stopwatch")} />
      )}
    </div>
  );
}
