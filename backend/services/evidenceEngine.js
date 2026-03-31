const { DEFAULT_THRESHOLDS } = require("./defaults");
const { clamp } = require("./signalConditioner");

function summarizeEvidenceLevel(coverageScore) {
  if (coverageScore >= 0.8) {
    return "STRONG";
  }

  if (coverageScore >= 0.6) {
    return "SUPPORTED";
  }

  if (coverageScore >= 0.4) {
    return "LIMITED";
  }

  return "INSUFFICIENT";
}

function buildEvidence(sessionStats, context, sequence) {
  const meaningfulActions =
    sessionStats.totalKeys +
    sessionStats.totalClicks +
    sessionStats.totalScrolls +
    sessionStats.totalMouseMoves;
  const distinctEventTypes = sessionStats.distinctEventTypes;
  const markers = {
    hasReading: context.readingPhase.active || sessionStats.totalScrolls > 0,
    hasTyping: sessionStats.totalKeys > 0,
    hasMouse: sessionStats.totalMouseMoves > 0,
    hasSubmit: sessionStats.totalSubmits > 0,
    hasSupportingActionBeforeSubmit: !sequence.submitWithoutAction && !sequence.submitWithoutTyping
  };

  const coverageScore = clamp(
    sessionStats.totalEvents / DEFAULT_THRESHOLDS.minEventsForDecision,
    0,
    1
  ) * 0.3 +
    clamp(meaningfulActions / DEFAULT_THRESHOLDS.minMeaningfulActionsForDecision, 0, 1) * 0.25 +
    clamp(sessionStats.durationMs / DEFAULT_THRESHOLDS.minDecisionDurationMs, 0, 1) * 0.2 +
    clamp(distinctEventTypes / DEFAULT_THRESHOLDS.minDistinctEventTypesForDecision, 0, 1) * 0.15 +
    (
      (markers.hasReading ? 1 : 0) +
      (markers.hasTyping ? 1 : 0) +
      (markers.hasMouse ? 1 : 0) +
      (markers.hasSubmit ? 1 : 0)
    ) / 4 * 0.1;

  const blockers = [];

  if (sessionStats.totalEvents < DEFAULT_THRESHOLDS.minEventsForDecision) {
    blockers.push(
      `Only ${sessionStats.totalEvents} events were captured; at least ${DEFAULT_THRESHOLDS.minEventsForDecision} are preferred.`
    );
  }

  if (meaningfulActions < DEFAULT_THRESHOLDS.minMeaningfulActionsForDecision) {
    blockers.push(
      `Only ${meaningfulActions} meaningful actions were observed; decision support is thin.`
    );
  }

  if (sessionStats.durationMs < DEFAULT_THRESHOLDS.minDecisionDurationMs) {
    blockers.push(
      `The session lasted ${Math.round(sessionStats.durationMs)} ms, which is too short for a stable behavioral read.`
    );
  }

  if (distinctEventTypes < DEFAULT_THRESHOLDS.minDistinctEventTypesForDecision) {
    blockers.push("Too few interaction types were captured to verify the behavioral pattern.");
  }

  if (sequence.submitWithoutAction) {
    blockers.push("A submit action appeared without supporting interaction leading into it.");
  }

  if (sequence.submitWithoutTyping) {
    blockers.push("A submit action appeared without any typing activity.");
  }

  const sufficient =
    coverageScore >= DEFAULT_THRESHOLDS.minEvidenceCoverageForDecision &&
    blockers.length === 0;
  const limited = !sufficient && coverageScore >= DEFAULT_THRESHOLDS.minEvidenceCoverageForLimitedDecision;
  const qualityLabel = summarizeEvidenceLevel(coverageScore);
  const summary = sufficient
    ? `Evidence quality is ${qualityLabel.toLowerCase()} with enough behavioral coverage to support a decision.`
    : `Evidence quality is ${qualityLabel.toLowerCase()}; VERITX should treat this session as inconclusive.`;

  return {
    coverageScore: clamp(coverageScore, 0, 1),
    qualityLabel,
    sufficient,
    limited,
    blockers,
    markers,
    meaningfulActions,
    distinctEventTypes,
    summary
  };
}

module.exports = {
  buildEvidence
};
