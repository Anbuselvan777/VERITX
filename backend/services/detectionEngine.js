const { DEFAULT_BASELINE_FEATURES, DEFAULT_THRESHOLDS } = require("./defaults");
const { clamp } = require("./signalConditioner");

function getFeatureStats(baseline, feature) {
  return baseline?.features?.[feature] || DEFAULT_BASELINE_FEATURES[feature] || {
    mean: 0,
    stdDev: 1,
    min: 0,
    max: 1
  };
}

function computeZScore(value, stats) {
  const deviation = stats.stdDev || Math.sqrt(stats.variance || 1) || 1;
  return (value - stats.mean) / deviation;
}

function buildRuleFlags(features, context, sequence, evidence, baseline) {
  const rules = [];
  const clickVarianceStats = getFeatureStats(baseline, "clickIntervalVariance");
  const hesitationStats = getFeatureStats(baseline, "hesitationTime");
  const correctionStats = getFeatureStats(baseline, "correctionRate");

  if (
    evidence.sufficient &&
    features.clickIntervalVariance < clickVarianceStats.mean - clickVarianceStats.stdDev * 1.2
  ) {
    rules.push({
      id: "low-click-variance",
      description: "Low click variance indicates a mechanically regular click cadence.",
      impact: 0.72
    });
  }

  if (
    context.typingPhase.active &&
    features.hesitationTime < Math.max(DEFAULT_THRESHOLDS.noHesitationMs, hesitationStats.mean - hesitationStats.stdDev)
  ) {
    rules.push({
      id: "no-hesitation",
      description: "Typing started with no meaningful hesitation.",
      impact: 0.68
    });
  }

  if (
    context.typingPhase.active &&
    features.typingSpeed > 0 &&
    features.correctionRate < Math.max(DEFAULT_THRESHOLDS.correctionFloor, correctionStats.mean - correctionStats.stdDev)
  ) {
    rules.push({
      id: "no-correction",
      description: "Sustained typing happened without normal correction behavior.",
      impact: 0.54
    });
  }

  if (context.tags.includes("suspicious")) {
    rules.push({
      id: "fast-input-no-reading",
      description: "Fast typing happened without a prior reading phase.",
      impact: 0.8
    });
  }

  if (sequence.missingSteps.includes("READ") || sequence.missingSteps.includes("PAUSE")) {
    rules.push({
      id: "sequence-gap",
      description: "Expected behavioral steps are missing from the interaction flow.",
      impact: 0.6
    });
  }

  if (sequence.submitWithoutAction || sequence.submitWithoutTyping) {
    rules.push({
      id: "unsupported-submit",
      description: "A submit action was observed without enough supporting interaction before it.",
      impact: 0.76
    });
  }

  return rules;
}

function buildStatisticalFlags(featureValues, sequence, support, evidence, baseline) {
  const threshold =
    DEFAULT_THRESHOLDS.zScoreThreshold + (evidence.sufficient ? 0 : evidence.limited ? 0.35 : 0.75);
  const trackedFeatures = {
    clickIntervalVariance: {
      value: featureValues.clickIntervalVariance,
      support: support.clickIntervals,
      minSupport: 2
    },
    hesitationTime: {
      value: featureValues.hesitationTime,
      support: support.keys,
      minSupport: 1
    },
    correctionRate: {
      value: featureValues.correctionRate,
      support: support.keys,
      minSupport: 5
    },
    typingSpeed: {
      value: featureValues.typingSpeed,
      support: support.printableKeys,
      minSupport: 4
    },
    mouseMovementEntropy: {
      value: featureValues.mouseMovementEntropy,
      support: support.mouseMoves,
      minSupport: 3
    },
    readingTime: {
      value: featureValues.readingTime,
      support: support.meaningfulActions,
      minSupport: 1
    },
    idleMean: {
      value: featureValues.idleMean,
      support: support.idleDurations,
      minSupport: 1
    },
    sequenceAnomaly: {
      value: sequence.anomalyScore,
      support: support.totalEvents,
      minSupport: 4
    },
    transitionVolatility: {
      value: sequence.transitionVolatility,
      support: support.totalEvents,
      minSupport: 4
    }
  };

  return Object.entries(trackedFeatures)
    .filter(([, config]) => config.support >= config.minSupport)
    .map(([feature, config]) => {
      const stats = getFeatureStats(baseline, feature);
      const zScore = computeZScore(config.value, stats);
      const lowerBound = stats.mean - threshold * (stats.stdDev || 1);
      const upperBound = stats.mean + threshold * (stats.stdDev || 1);
      return {
        feature,
        value: config.value,
        support: config.support,
        zScore,
        lowerBound,
        upperBound,
        threshold,
        triggered: Math.abs(zScore) > threshold
      };
    })
    .filter((item) => item.triggered)
    .sort((left, right) => Math.abs(right.zScore) - Math.abs(left.zScore));
}

function runDetection(features, context, sequence, evidence, baseline) {
  const ruleFlags = buildRuleFlags(features.values, context, sequence, evidence, baseline);
  const statisticalFlags = buildStatisticalFlags(features.values, sequence, features.support, evidence, baseline);

  const ruleScore = clamp(ruleFlags.reduce((sum, rule) => sum + rule.impact, 0) / Math.max(1, ruleFlags.length), 0, 1);
  const statScore = clamp(
    statisticalFlags.reduce((sum, item) => sum + Math.min(1, Math.abs(item.zScore) / 4), 0) / Math.max(1, statisticalFlags.length || 1),
    0,
    1
  );
  const sequenceScore = clamp(sequence.anomalyScore, 0, 1);
  const baseScore = clamp(ruleScore * 0.3 + statScore * 0.5 + sequenceScore * 0.2, 0, 1);
  const decisionWeight = evidence.sufficient ? 1 : evidence.limited ? 0.72 : 0.4;
  const finalScore = clamp(baseScore * decisionWeight, 0, 1);

  return {
    ruleFlags,
    statisticalFlags,
    ruleScore,
    statScore,
    sequenceScore,
    baseScore,
    decisionWeight,
    finalScore,
    thresholds: {
      zScoreThreshold: DEFAULT_THRESHOLDS.zScoreThreshold
    }
  };
}

module.exports = {
  runDetection
};
