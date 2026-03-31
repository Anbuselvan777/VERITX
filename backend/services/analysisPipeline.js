const { conditionSignals } = require("./signalConditioner");
const { extractFeatures } = require("./featureExtractor");
const { inferContext } = require("./contextEngine");
const { analyzeSequence } = require("./sequenceEngine");
const { optimizeIntelligence } = require("./optimizationEngine");
const { buildEvidence } = require("./evidenceEngine");
const { runDetection } = require("./detectionEngine");
const { computeScores } = require("./scoringEngine");
const { buildExplainability } = require("./explainabilityEngine");

function detectSessionDrift(events) {
  if (events.length < 12) {
    return {
      detected: false,
      score: 0,
      summary: "Not enough events for drift analysis.",
      deltas: {}
    };
  }

  const midpoint = Math.floor(events.length / 2);
  const firstHalf = events.slice(0, midpoint);
  const secondHalf = events.slice(midpoint);
  const firstFeatures = extractFeatures(firstHalf, conditionSignals(firstHalf));
  const secondFeatures = extractFeatures(secondHalf, conditionSignals(secondHalf));

  const deltas = {
    typingSpeed: Math.abs(secondFeatures.values.typingSpeed - firstFeatures.values.typingSpeed),
    hesitationTime: Math.abs(secondFeatures.values.hesitationTime - firstFeatures.values.hesitationTime),
    correctionRate: Math.abs(secondFeatures.values.correctionRate - firstFeatures.values.correctionRate),
    mouseMovementEntropy: Math.abs(secondFeatures.values.mouseMovementEntropy - firstFeatures.values.mouseMovementEntropy)
  };

  const normalizedScore = Math.min(
    1,
    deltas.typingSpeed / 5 + deltas.hesitationTime / 1200 + deltas.correctionRate * 3 + deltas.mouseMovementEntropy / 3
  );

  return {
    detected: normalizedScore > 0.55,
    score: normalizedScore,
    summary:
      normalizedScore > 0.55
        ? "Interaction rhythm changed materially between the first and second half of the session."
        : "Behavior remained stable across the session.",
    deltas
  };
}

function buildHeatmap(events) {
  return events
    .filter((event) => event.type === "mousemove")
    .map((event) => ({
      x: Number(event.x || 0),
      y: Number(event.y || 0),
      intensity: Number(event.velocity || 0)
    }));
}

function createReport(session, baseline) {
  const conditionedSignals = conditionSignals(session.events);
  const features = extractFeatures(conditionedSignals.sortedEvents, conditionedSignals);
  const context = inferContext(conditionedSignals.sortedEvents, features);
  const sequence = analyzeSequence(conditionedSignals.sortedEvents);
  const evidence = buildEvidence(features.sessionStats, context, sequence);
  const optimization = optimizeIntelligence(conditionedSignals, features.featureVarianceMap, sequence);
  const drift = detectSessionDrift(conditionedSignals.sortedEvents);
  const detection = runDetection(features, context, sequence, evidence, baseline);
  const scoring = computeScores(features, detection, context, optimization, drift, evidence);
  const explanation = buildExplainability(features, context, sequence, detection, scoring, evidence, baseline, drift);

  return {
    sessionId: session.id,
    profileId: session.profileId,
    generatedAt: new Date().toISOString(),
    features: features.values,
    idleDistribution: features.idleDistribution,
    sessionStats: features.sessionStats,
    context,
    sequence,
    evidence,
    optimization,
    detection,
    scoring,
    drift,
    explanation,
    visuals: {
      timeline: features.visualSignals.timeline,
      distributions: {
        clickIntervals: features.visualSignals.clickIntervals,
        keyIntervals: features.visualSignals.keyIntervals,
        idleDurations: features.visualSignals.idleDurations,
        mouseVelocity: features.visualSignals.mouseVelocity
      },
      heatmap: buildHeatmap(conditionedSignals.sortedEvents)
    }
  };
}

module.exports = {
  createReport
};
