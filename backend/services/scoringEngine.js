const { clamp } = require("./signalConditioner");

function normalizedEntropy(distribution) {
  const total = distribution.reduce((sum, value) => sum + value, 0) || 1;
  const probabilities = distribution.map((value) => value / total).filter((value) => value > 0);
  const entropy = probabilities.reduce((sum, probability) => sum - probability * Math.log2(probability), 0);
  const maxEntropy = Math.log2(Math.max(probabilities.length, 2));
  return maxEntropy ? entropy / maxEntropy : 0;
}

function labelConfidence(confidence) {
  if (confidence >= 0.78) {
    return "HIGH";
  }

  if (confidence >= 0.52) {
    return "MEDIUM";
  }

  return "LOW";
}

function blendTowardNeutral(value, strength) {
  return 0.5 + (value - 0.5) * strength;
}

function computeScores(features, detection, context, optimization, drift, evidence) {
  const weightedSignals = optimization.featureImportance.slice(0, 6).map((item) => ({
    feature: item.feature,
    weight: item.weight,
    value: features.values[item.feature] ?? 0
  }));

  const rawAutomationRisk = clamp(
    detection.finalScore * 0.68 + context.suspicionScore * 0.2 + (drift.score || 0) * 0.12,
    0,
    1
  );
  const rawHumanLikelihood = clamp(
    1 -
      rawAutomationRisk +
      Math.min(0.15, features.values.correctionRate * 0.4) +
      Math.min(0.12, features.values.mouseMovementEntropy * 0.03),
    0,
    1
  );
  const evidenceStrength = evidence.sufficient ? 1 : Math.max(0.18, evidence.coverageScore);
  const automationRisk = clamp(blendTowardNeutral(rawAutomationRisk, evidenceStrength), 0, 1);
  const humanLikelihood = clamp(blendTowardNeutral(rawHumanLikelihood, evidenceStrength), 0, 1);

  const signalDistribution = [
    (detection.ruleScore + context.suspicionScore) / 2,
    detection.statScore,
    detection.sequenceScore + (drift.score || 0) / 2
  ];
  const anomalyConsensus = signalDistribution.reduce((sum, value) => sum + value, 0) / signalDistribution.length;
  const clarity = clamp(1 - normalizedEntropy([anomalyConsensus, 1 - anomalyConsensus]), 0, 1);
  const confidence = clamp(
    clarity * 0.35 + evidence.coverageScore * 0.5 + detection.decisionWeight * 0.15,
    0,
    1
  );

  return {
    humanLikelihood,
    automationRisk,
    weightedSignals,
    confidence,
    confidenceLabel: labelConfidence(confidence)
  };
}

module.exports = {
  computeScores
};
