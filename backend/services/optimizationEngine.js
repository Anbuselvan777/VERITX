const { average, clamp } = require("./signalConditioner");

function computeFeatureImportance(featureVarianceMap) {
  const totalVariance = Object.values(featureVarianceMap).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  return Object.entries(featureVarianceMap)
    .map(([feature, value]) => ({
      feature,
      variance: value,
      weight: value / totalVariance
    }))
    .sort((left, right) => right.weight - left.weight);
}

function optimizeIntelligence(conditionedSignals, featureVarianceMap, sequence) {
  const qualitySummary = Object.values(conditionedSignals.signalQuality);
  const averageSmoothness = average(qualitySummary.map((item) => item.smoothness));
  const averageNoiseRemoved = average(qualitySummary.map((item) => item.noiseRemoved));

  return {
    signalQualityOptimization: {
      averageSmoothness,
      averageNoiseRemoved,
      details: conditionedSignals.signalQuality
    },
    featureImportance: computeFeatureImportance(featureVarianceMap),
    temporalPatternIntelligence: {
      topTransitions: Object.entries(sequence.transitionProbabilities)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([transition, probability]) => ({ transition, probability })),
      repeatedPatterns: sequence.repeatedPatterns,
      anomalyPressure: clamp(sequence.anomalyScore + sequence.transitionVolatility * 0.25, 0, 1)
    }
  };
}

module.exports = {
  optimizeIntelligence
};
