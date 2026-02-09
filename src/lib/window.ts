import {
  getCurrentWindow,
  currentMonitor,
  PhysicalPosition,
} from "@tauri-apps/api/window";

/**
 * Position and show the window at the bottom-right of the work area
 * (just above the Windows taskbar / notification area).
 */
export async function showWindowAboveTray() {
  const win = getCurrentWindow();
  const monitor = await currentMonitor();
  if (monitor) {
    const { workArea } = monitor;
    const winSize = await win.outerSize();
    const x = workArea.position.x + workArea.size.width - winSize.width - 12;
    const y = workArea.position.y + workArea.size.height - winSize.height - 12;
    await win.setPosition(new PhysicalPosition(x, y));
  }
  await win.show();
  await win.setFocus();
}
