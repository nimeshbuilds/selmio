import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error The strip-types runner requires explicit .ts extensions.
import { createDemoWorkspace, createEmptyWorkspace } from "./finance.ts";
// @ts-expect-error The strip-types runner requires explicit .ts extensions.
import { practiceWorkspaceReducer, type PracticeWorkspaceState } from "./practice-workspace.ts";

const initial = (): PracticeWorkspaceState => ({ personal: { ...createEmptyWorkspace(), bufferCents: 87500 }, practice: null });
const start = (state: PracticeWorkspaceState, sessionId = "session-1") => practiceWorkspaceReducer(state, { type: "start", sessionId, scenarioId: "example", workspace: createDemoWorkspace() });

test("practice edits and exit preserve the exact personal workspace", () => {
  const state = initial();
  const practicing = start(state);
  const edited = practiceWorkspaceReducer(practicing, { type: "edit", sessionId: "session-1", update: w => ({ ...w, bufferCents: 99900 }) });
  assert.equal(edited.practice?.workspace.bufferCents, 99900);
  assert.strictEqual(edited.personal, state.personal);
  const exited = practiceWorkspaceReducer(edited, { type: "exit" });
  assert.equal(exited.practice, null);
  assert.strictEqual(exited.personal, state.personal);
});

test("practice fixtures are cloned, and restarting discards only practice changes", () => {
  const fixture = createDemoWorkspace();
  const state = practiceWorkspaceReducer(initial(), { type: "start", sessionId: "one", scenarioId: "example", workspace: fixture });
  state.practice!.workspace.accounts[0].balanceCents = 1;
  assert.notEqual(fixture.accounts[0].balanceCents, 1);
  const restarted = start(state, "two");
  assert.equal(restarted.practice?.workspace.accounts[0].balanceCents, fixture.accounts[0].balanceCents);
  assert.strictEqual(restarted.personal, state.personal);
});

test("late practice callbacks are ignored after exiting or starting a different session", () => {
  const state = start(initial());
  const late = { type: "edit" as const, sessionId: "session-1", update: createDemoWorkspace() };
  const exited = practiceWorkspaceReducer(state, { type: "exit" });
  assert.strictEqual(practiceWorkspaceReducer(exited, late), exited);
  const restarted = start(state, "session-2");
  assert.strictEqual(practiceWorkspaceReducer(restarted, late), restarted);
});

test("personal storage updates during practice are retained without replacing the exercise", () => {
  const state = start(initial());
  const updated = practiceWorkspaceReducer(state, { type: "replace-personal", workspace: { ...state.personal, bufferCents: 123400 } });
  assert.strictEqual(updated.practice, state.practice);
  assert.equal(practiceWorkspaceReducer(updated, { type: "exit" }).personal.bufferCents, 123400);
});
