const DEFAULT_BASELINE_FEATURES = {
  clickIntervalMean: { count: 20, mean: 820, m2: 450000, variance: 22500, stdDev: 150, min: 240, max: 2100 },
  clickIntervalVariance: { count: 20, mean: 18000, m2: 180000000, variance: 9000000, stdDev: 3000, min: 1200, max: 52000 },
  typingSpeed: { count: 20, mean: 4.4, m2: 28.8, variance: 1.44, stdDev: 1.2, min: 0.4, max: 10 },
  hesitationTime: { count: 20, mean: 360, m2: 800000, variance: 40000, stdDev: 200, min: 100, max: 1500 },
  correctionRate: { count: 20, mean: 0.09, m2: 0.05, variance: 0.0025, stdDev: 0.05, min: 0, max: 0.4 },
  idleMean: { count: 20, mean: 1300, m2: 6050000, variance: 302500, stdDev: 550, min: 300, max: 5000 },
  mouseMovementEntropy: { count: 20, mean: 2.6, m2: 7.2, variance: 0.36, stdDev: 0.6, min: 0.5, max: 4 },
  readingTime: { count: 20, mean: 2400, m2: 16200000, variance: 810000, stdDev: 900, min: 300, max: 12000 },
  sequenceAnomaly: { count: 20, mean: 0.22, m2: 0.45, variance: 0.0225, stdDev: 0.15, min: 0, max: 1 },
  transitionVolatility: { count: 20, mean: 0.36, m2: 0.45, variance: 0.0225, stdDev: 0.15, min: 0, max: 1 }
};

const DEFAULT_THRESHOLDS = {
  zScoreThreshold: 1.8,
  idleThresholdMs: 1200,
  pauseThresholdMs: 800,
  noHesitationMs: 60,
  correctionFloor: 0.01,
  suspiciousReadingMs: 500,
  expertReadingMs: 1600,
  fastTypingCps: 5.8,
  minEventsForDecision: 8,
  minMeaningfulActionsForDecision: 5,
  minDistinctEventTypesForDecision: 3,
  minDecisionDurationMs: 1800,
  minEvidenceCoverageForDecision: 0.58,
  minEvidenceCoverageForLimitedDecision: 0.38
};

const DEFAULT_STORAGE = {
  sessions: {}
};

const DEFAULT_BASELINES = {
  profiles: {
    default: {
      profileId: "default",
      sessions: 20,
      features: DEFAULT_BASELINE_FEATURES,
      lastUpdatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString()
    }
  }
};

module.exports = {
  DEFAULT_BASELINE_FEATURES,
  DEFAULT_THRESHOLDS,
  DEFAULT_STORAGE,
  DEFAULT_BASELINES
};
