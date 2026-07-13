import 'finch';

declare module 'finch' {
  interface CanvasWindowOptions {
    /** 允许窗口越出屏幕工作区，默认 false。 */
    allowOffscreen?: boolean;
    /** 不在 Mission Control（调度中心）中显示，默认 false。仅 macOS，其他平台忽略。 */
    hiddenInMissionControl?: boolean;
    /** 在所有工作区显示，默认 false。仅 macOS，其他平台忽略。 */
    visibleOnAllWorkspaces?: boolean;
  }
}
