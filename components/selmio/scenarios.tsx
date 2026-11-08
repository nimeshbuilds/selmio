"use client";

import { createContext, useContext, useId } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  Download,
  FileUp,
  FlaskConical,
  Grid2X2,
  LogOut,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { BudgetScenario } from "@/lib/scenarios";
import { downloadFile } from "@/lib/workspace-store";
import "./scenarios.css";

const scenarioIcons: Record<string, LucideIcon> = {
  "weekend-purchase": ShoppingBag,
  "timing-trap": CalendarDays,
  "pending-or-duplicate": Copy,
  "late-paycheck": Clock3,
  "emergency-buffer": ShieldCheck,
  "savings-goal": Target,
  "credit-card-repayment": CreditCard,
  "csv-import": FileUp,
  "separate-accounts": Wallet,
  "backup-restore": Download,
};

const formatCash = (amountCents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amountCents / 100);

function downloadScenarioCsv(scenario: BudgetScenario) {
  if (scenario.sampleCsv)
    downloadFile(
      `selmio-${scenario.id}.csv`,
      scenario.sampleCsv,
      "text/csv;charset=utf-8",
    );
}

export function ScenarioGallery({
  scenarios,
  onStart,
  exploredIds,
}: {
  scenarios: BudgetScenario[];
  onStart: (id: string) => void;
  exploredIds: string[];
}) {
  const headingId = useId();
  const explored = new Set(exploredIds);
  const exploredCount = scenarios.filter((scenario) =>
    explored.has(scenario.id),
  ).length;
  return (
    <section className="scenario-gallery" aria-labelledby={headingId}>
      <div className="scenario-gallery-intro">
        <div className="scenario-gallery-intro-copy">
          <span className="scenario-eyebrow">
            <FlaskConical size={15} aria-hidden="true" />
            A LITTLE PRACTICE
          </span>
          <h2 id={headingId}>Everyday choices. A clearer picture.</h2>
          <p>
            Try a sample plan, follow a few steps, and see what changes. Choose
            any scenario that feels familiar.
          </p>
          <span className="scenario-isolation-note">
            <ShieldCheck size={15} aria-hidden="true" />
            Practice workspace · fictional money · real calculations
          </span>
        </div>
        <div className="scenario-gallery-progress">
          <div>
            <strong>{exploredCount}</strong>
            <span> / {scenarios.length}</span>
          </div>
          <p>walkthroughs explored</p>
          <progress
            value={exploredCount}
            max={Math.max(1, scenarios.length)}
            aria-label={`${exploredCount} of ${scenarios.length} walkthroughs explored`}
          />
          <span>One small insight at a time.</span>
        </div>
      </div>

      <div className="scenario-gallery-heading">
        <h3>Find your starting point</h3>
        <span>
          <Clock3 size={14} aria-hidden="true" />
          Short, self-guided walkthroughs
        </span>
      </div>
      <ol className="scenario-gallery-grid">
        {scenarios.map((scenario, index) => {
          const Icon = scenarioIcons[scenario.id] ?? Sparkles;
          const isExplored = explored.has(scenario.id);
          const cashAccount = scenario.workspace.accounts.find(
            (account) => account.type !== "credit",
          );
          return (
            <li key={scenario.id}>
              <article
                className={`scenario-card scenario-card-tone-${index % 3}`}
                aria-labelledby={`${headingId}-${scenario.id}`}
              >
                <div className="scenario-card-top">
                  <span className="scenario-card-icon">
                    <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <span className="scenario-card-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="scenario-card-meta">
                  <span>{scenario.category}</span>
                  <span>{scenario.duration}</span>
                </div>
                <h4 id={`${headingId}-${scenario.id}`}>{scenario.title}</h4>
                <p className="scenario-card-summary">{scenario.summary}</p>
                <dl className="scenario-card-facts">
                  <div>
                    <dt>Starting cash</dt>
                    <dd>
                      {cashAccount ? formatCash(cashAccount.balanceCents) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Walkthrough</dt>
                    <dd>{scenario.steps.length} steps</dd>
                  </div>
                </dl>
                <div className="scenario-card-actions">
                  <button
                    type="button"
                    className="scenario-button scenario-button-primary"
                    onClick={() => onStart(scenario.id)}
                    aria-label={`${isExplored ? "Explore again" : "Start scenario"}: ${scenario.title}`}
                  >
                    {isExplored ? "Explore again" : "Start scenario"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                  {isExplored && (
                    <span className="scenario-explored-label">
                      <Check size={14} aria-hidden="true" />
                      Explored
                    </span>
                  )}
                </div>
                {scenario.sampleCsv && (
                  <button
                    type="button"
                    className="scenario-text-button scenario-csv-download"
                    onClick={() => downloadScenarioCsv(scenario)}
                  >
                    <Download size={14} aria-hidden="true" />
                    Download sample CSV
                  </button>
                )}
              </article>
            </li>
          );
        })}
      </ol>
      <p className="scenario-gallery-footnote">
        Progress is marked by you. Exploring a scenario does not verify an
        action or your personal finances.
      </p>
    </section>
  );
}

export type ScenarioGuideState = {
  scenario: BudgetScenario;
  stepIndex: number;
  onStepChange: (index: number) => void;
  onLaunch: () => void;
  onExit: () => void;
  onReset: () => void;
  onBrowse: () => void;
};

export const ScenarioGuideContext = createContext<ScenarioGuideState | null>(
  null,
);

export function ScenarioCoach({ compact = false }: { compact?: boolean }) {
  const guide = useContext(ScenarioGuideContext);
  const headingId = useId();
  if (!guide) return null;

  const { scenario, onStepChange, onLaunch, onExit, onReset, onBrowse } = guide;
  const totalSteps = scenario.steps.length;
  const index = Math.max(
    0,
    Math.min(
      Number.isFinite(guide.stepIndex) ? Math.floor(guide.stepIndex) : 0,
      totalSteps,
    ),
  );
  const isComplete = index >= totalSteps;
  const step = scenario.steps[index];

  if (isComplete)
    return (
      <section
        className={`scenario-coach scenario-coach-complete${compact ? " scenario-coach-compact" : ""}`}
        aria-labelledby={headingId}
      >
        <div className="scenario-completion-icon">
          <CheckCircle2 size={25} strokeWidth={1.6} aria-hidden="true" />
        </div>
        <div className="scenario-completion-copy">
          <span className="scenario-eyebrow">SELF-GUIDED PRACTICE</span>
          <h2 id={headingId}>Scenario explored.</h2>
          <p className="scenario-completed-title">{scenario.title}</p>
          <p className="scenario-lesson">{scenario.lesson}</p>
          <span className="scenario-manual-note">
            You marked the walkthrough explored. Actions are not automatically
            verified.
          </span>
        </div>
        <div className="scenario-completion-actions">
          <button
            type="button"
            className="scenario-button scenario-button-primary"
            onClick={onBrowse}
          >
            <Grid2X2 size={15} aria-hidden="true" />
            Browse scenarios
          </button>
          <button
            type="button"
            className="scenario-text-button"
            onClick={onReset}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Restart
          </button>
          <button
            type="button"
            className="scenario-text-button"
            onClick={onExit}
          >
            <LogOut size={14} aria-hidden="true" />
            Exit practice
          </button>
        </div>
      </section>
    );

  return (
    <section
      className={`scenario-coach${compact ? " scenario-coach-compact" : ""}`}
      aria-labelledby={headingId}
    >
      <div className="scenario-coach-header">
        <span className="scenario-eyebrow">
          <FlaskConical size={14} aria-hidden="true" />
          PRACTICE WORKSPACE
        </span>
        <span className="scenario-coach-isolation">Sample money</span>
      </div>
      <div className="scenario-coach-body">
        <div className="scenario-step-header">
          <div>
            <p className="scenario-current-title">{scenario.title}</p>
            <h2 id={headingId}>{step.title}</h2>
          </div>
          <span className="scenario-step-count">
            Step {index + 1} of {totalSteps}
          </span>
        </div>
        {!compact && (
          <progress
            className="scenario-step-progress"
            value={index + 1}
            max={totalSteps}
            aria-label={`Current step ${index + 1} of ${totalSteps}`}
          />
        )}
        <p className="scenario-step-instruction">{step.instruction}</p>
        <div className="scenario-step-check">
          <CheckCircle2 size={18} strokeWidth={1.7} aria-hidden="true" />
          <div>
            <strong>What to look for</strong>
            <p>{step.check}</p>
          </div>
        </div>
        <div className="scenario-step-actions">
          {!compact && (
            <button
              type="button"
              className="scenario-button scenario-button-primary scenario-launch"
              onClick={onLaunch}
            >
              {step.actionLabel}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
          <div className="scenario-step-navigation">
            <button
              type="button"
              className="scenario-button scenario-button-secondary"
              disabled={index === 0}
              onClick={() => onStepChange(index - 1)}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              className="scenario-button scenario-button-secondary"
              onClick={() => onStepChange(index + 1)}
            >
              {index === totalSteps - 1 ? "Mark explored" : "Next step"}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="scenario-manual-note">
          Steps are self-guided. Back keeps your edits; Restart resets the sample.
        </p>
      </div>
      {!compact && (
        <div className="scenario-coach-footer">
          <div>
            <button
              type="button"
              className="scenario-text-button"
              onClick={onReset}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Restart
            </button>
            <button
              type="button"
              className="scenario-text-button"
              onClick={onBrowse}
            >
              <Grid2X2 size={14} aria-hidden="true" />
              All scenarios
            </button>
            {scenario.sampleCsv && (
              <button
                type="button"
                className="scenario-text-button"
                onClick={() => downloadScenarioCsv(scenario)}
              >
                <Download size={14} aria-hidden="true" />
                Sample CSV
              </button>
            )}
          </div>
          <button
            type="button"
            className="scenario-text-button"
            onClick={onExit}
          >
            <LogOut size={14} aria-hidden="true" />
            Exit practice
          </button>
        </div>
      )}
    </section>
  );
}
