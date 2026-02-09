import { useState, useEffect, useRef } from "react";
import { Play, Square, RotateCcw, Bell, BellOff } from "lucide-react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "../lib/cn";
import { showWindowAboveTray } from "../lib/window";

export function Timer() {
  // Form state
  const [alertName, setAlertName] = useState("");
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [silentMode, setSilentMode] = useState(false);

  // Timer state
  const [isRunning, setIsRunning] = useState(false);
  const [remaining, setRemaining] = useState(0);

  // Refs for the finish callback (avoid stale closures)
  const silentRef = useRef(silentMode);
  const alertNameRef = useRef(alertName);
  useEffect(() => {
    silentRef.current = silentMode;
  }, [silentMode]);
  useEffect(() => {
    alertNameRef.current = alertName;
  }, [alertName]);

  const handleStart = () => {
    const total = minutes * 60 + seconds;
    if (total <= 0) return;
    setRemaining(total);
    setIsRunning(true);
  };

  const handleStop = () => {
    setIsRunning(false);
  };

  const handleReset = () => {
    setIsRunning(false);
    setRemaining(0);
  };

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
  }, [isRunning]);

  async function onTimerFinish() {
    // Send notification (if not silent)
    if (!silentRef.current) {
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
    }

    // Show window if hidden
    const win = getCurrentWindow();
    const isVisible = await win.isVisible();
    if (!isVisible) {
      await showWindowAboveTray();
    }
  }

  // Format remaining as MM:SS
  const displayMin = Math.floor(remaining / 60)
    .toString()
    .padStart(2, "0");
  const displaySec = (remaining % 60).toString().padStart(2, "0");

  // Progress percentage for visual ring
  const totalDuration = minutes * 60 + seconds;
  const progress =
    totalDuration > 0 && isRunning
      ? ((totalDuration - remaining) / totalDuration) * 100
      : remaining === 0 && !isRunning && totalDuration > 0
        ? 100
        : 0;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto px-4 py-4">
      {/* Alert Name */}
      <div className="mb-4">
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

      {/* Duration inputs */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Minutos</label>
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
          <label className="block text-xs text-gray-500 mb-1">Segundos</label>
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

      {/* Silent mode toggle */}
      <button
        onClick={() => setSilentMode(!silentMode)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-6 transition-all duration-200 w-full justify-center",
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
        {silentMode ? "Modo Silencioso Ativado" : "Notificações Ativadas"}
      </button>

      {/* Countdown display */}
      <div className="flex items-center justify-center mb-6">
        <div className="relative flex items-center justify-center w-40 h-40">
          {/* Background ring */}
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
              className="text-indigo-500 transition-all duration-1000"
            />
          </svg>
          <span className="text-4xl font-mono font-bold text-gray-100 tabular-nums">
            {displayMin}:{displaySec}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        {!isRunning ? (
          <button
            onClick={handleStart}
            disabled={minutes * 60 + seconds <= 0}
            className={cn(
              "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              minutes * 60 + seconds > 0
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
          disabled={remaining === 0 && !isRunning}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
            remaining > 0 || isRunning
              ? "bg-gray-800 hover:bg-gray-700 text-gray-300"
              : "bg-gray-800 text-gray-600 cursor-not-allowed",
          )}
        >
          <RotateCcw className="w-4 h-4" />
          Resetar
        </button>
      </div>

      {/* Timer finished indicator */}
      {remaining === 0 && !isRunning && progress === 100 && (
        <div className="mt-4 text-center">
          <p className="text-sm text-emerald-400 font-medium">
            {alertNameRef.current
              ? `"${alertNameRef.current}" — Tempo esgotado!`
              : "Tempo esgotado!"}
          </p>
        </div>
      )}
    </div>
  );
}
