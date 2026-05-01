import type { TradingRunHistoryRecord } from "./history";

export interface PaperTradingReadiness {
  ready: boolean;
  requiredPaperDays: number;
  completedPaperDays: number;
  completedPaperRuns: number;
  failedPaperRuns: number;
  failedSubmissions: number;
  submittedOrders: number;
  firstPaperAsOf: string | null;
  latestPaperAsOf: string | null;
  blockers: string[];
}

export interface LiveApprovalInput {
  liveEnabled: boolean;
  confirmationToken?: string;
  expectedConfirmationToken?: string;
  approvedDryRunId?: string;
  latestDryRunId?: string | null;
}

export interface LiveApprovalReadiness {
  ready: boolean;
  blockers: string[];
}

export interface LiveTradingReadiness {
  ready: boolean;
  paper: PaperTradingReadiness;
  approval: LiveApprovalReadiness;
}

const DEFAULT_REQUIRED_PAPER_DAYS = 20;

export function evaluatePaperTradingReadiness(
  records: TradingRunHistoryRecord[],
  requiredPaperDays = DEFAULT_REQUIRED_PAPER_DAYS
): PaperTradingReadiness {
  const paperRuns = records.filter((record) => record.run.mode === "paper");
  const completedPaperRuns = paperRuns.filter((record) => record.run.status === "completed");
  const completedPaperDays = new Set(completedPaperRuns.map((record) => record.run.asOf).filter(Boolean));
  const sortedPaperDays = Array.from(completedPaperDays).sort((left, right) => left.localeCompare(right));
  const failedPaperRuns = paperRuns.filter((record) => record.run.status === "failed").length;
  const failedSubmissions = paperRuns.reduce(
    (total, record) => total + (record.submissions?.filter((submission) => submission.status === "failed").length ?? 0),
    0
  );
  const submittedOrders = paperRuns.reduce(
    (total, record) => total + (record.submissions?.filter((submission) => submission.status === "submitted").length ?? 0),
    0
  );
  const blockers: string[] = [];

  if (completedPaperDays.size < requiredPaperDays) {
    blockers.push(`Need ${requiredPaperDays} completed paper trading days; found ${completedPaperDays.size}.`);
  }
  if (failedPaperRuns > 0) {
    blockers.push(`Paper history contains ${failedPaperRuns} failed run(s).`);
  }
  if (failedSubmissions > 0) {
    blockers.push(`Paper history contains ${failedSubmissions} failed submission(s).`);
  }
  if (submittedOrders === 0) {
    blockers.push("Paper history has no submitted orders to review.");
  }

  return {
    ready: blockers.length === 0,
    requiredPaperDays,
    completedPaperDays: completedPaperDays.size,
    completedPaperRuns: completedPaperRuns.length,
    failedPaperRuns,
    failedSubmissions,
    submittedOrders,
    firstPaperAsOf: sortedPaperDays[0] ?? null,
    latestPaperAsOf: sortedPaperDays[sortedPaperDays.length - 1] ?? null,
    blockers
  };
}

export function latestDryRunId(records: TradingRunHistoryRecord[]) {
  return records.find((record) => record.run.mode === "dry-run" && record.run.status === "completed")?.run.id ?? null;
}

export function evaluateLiveApproval(input: LiveApprovalInput): LiveApprovalReadiness {
  const blockers: string[] = [];

  if (!input.liveEnabled) {
    blockers.push("Live trading is disabled. Set AUTO_TRADING_LIVE_ENABLED=true.");
  }
  if (!input.expectedConfirmationToken) {
    blockers.push("Live confirmation token is not configured.");
  }
  if (!input.confirmationToken || input.confirmationToken !== input.expectedConfirmationToken) {
    blockers.push("Live confirmation token did not match.");
  }
  if (!input.approvedDryRunId) {
    blockers.push("An approved dry-run id is required.");
  } else if (input.latestDryRunId && input.approvedDryRunId !== input.latestDryRunId) {
    blockers.push("Approved dry-run id must match the latest completed dry-run.");
  }

  return {
    ready: blockers.length === 0,
    blockers
  };
}

export function evaluateLiveTradingReadiness(
  records: TradingRunHistoryRecord[],
  approval: LiveApprovalInput,
  requiredPaperDays = DEFAULT_REQUIRED_PAPER_DAYS
): LiveTradingReadiness {
  const paper = evaluatePaperTradingReadiness(records, requiredPaperDays);
  const resolvedApproval = evaluateLiveApproval({
    ...approval,
    latestDryRunId: approval.latestDryRunId ?? latestDryRunId(records)
  });

  return {
    ready: paper.ready && resolvedApproval.ready,
    paper,
    approval: resolvedApproval
  };
}
