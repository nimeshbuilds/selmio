import type { Workspace } from "./finance";

export type LocalWorkspace = Workspace & { sourceWarnings?: string[] };
export type WorkspaceUpdate = LocalWorkspace | ((workspace: LocalWorkspace) => LocalWorkspace);
export interface PracticeSession {
  sessionId: string;
  scenarioId: string;
  workspace: LocalWorkspace;
  stepIndex: number;
}
export interface PracticeWorkspaceState {
  personal: LocalWorkspace;
  practice: PracticeSession | null;
}
export type PracticeWorkspaceAction =
  | { type: "replace-personal"; workspace: LocalWorkspace }
  | { type: "edit"; sessionId: string | null; update: WorkspaceUpdate }
  | { type: "start"; sessionId: string; scenarioId: string; workspace: LocalWorkspace }
  | { type: "step"; stepIndex: number }
  | { type: "exit" };

/** Practice data never enters the personal workspace or its persistence stream. */
export function practiceWorkspaceReducer(state: PracticeWorkspaceState, action: PracticeWorkspaceAction): PracticeWorkspaceState {
  switch (action.type) {
    case "replace-personal":
      return { ...state, personal: action.workspace };
    case "start":
      return { ...state, practice: { sessionId: action.sessionId, scenarioId: action.scenarioId, workspace: structuredClone(action.workspace), stepIndex: 0 } };
    case "exit":
      return { ...state, practice: null };
    case "step":
      return state.practice ? { ...state, practice: { ...state.practice, stepIndex: Math.max(0, Math.trunc(action.stepIndex)) } } : state;
    case "edit": {
      const update = (workspace: LocalWorkspace) => typeof action.update === "function" ? action.update(workspace) : action.update;
      if (action.sessionId === null) return { ...state, personal: update(state.personal) };
      // A file read or callback from an exited/restarted exercise cannot write elsewhere.
      if (action.sessionId !== state.practice?.sessionId) return state;
      return { ...state, practice: { ...state.practice, workspace: update(state.practice.workspace) } };
    }
  }
}
