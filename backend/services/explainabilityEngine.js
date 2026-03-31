function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "0.00";
}

function buildInterpretation(automationRisk, evidence) {
  if (!evidence.sufficient) {
    return "Evidence is too limited for a reliable human-versus-automation decision.";
  }

  if (automationRisk >= 0.7) {
    return "Behavior strongly resembles automated interaction and should be reviewed.";
  }

  if (automationRisk >= 0.4) {
    return "Behavior shows moderate automation-like traits with notable inconsistencies.";
  }

  return "Behavior remains closer to a normal human interaction profile.";
}

function buildCounterfactuals(detection, baseline) {
  const counters = [];

  for (const flag of detection.statisticalFlags.slice(0, 3)) {
    const stats = baseline?.features?.[flag.feature];
    if (!stats) {
      continue;
    }

    counters.push({
      feature: flag.feature,
      expected: `${formatNumber(flag.lowerBound)} - ${formatNumber(flag.upperBound)}`,
      observed: formatNumber(flag.value),
      statement: `If ${flag.feature} stayed within ${formatNumber(flag.lowerBound)} to ${formatNumber(flag.upperBound)}, this signal would be considered normal.`
    });
  }

  return counters;
}

function buildExplainability(features, context, sequence, detection, scoring, evidence, baseline, drift) {
  const ruleLayer = detection.ruleFlags.map((rule) => ({
    id: rule.id,
    summary: rule.description
  }));

  const statisticalLayer = detection.statisticalFlags.map((flag) => ({
    feature: flag.feature,
    summary: `${flag.feature} deviates by ${formatNumber(Math.abs(flag.zScore), 1)} sigma from baseline using ${flag.support} supporting samples.`,
    observed: flag.value,
    expectedRange: [flag.lowerBound, flag.upperBound]
  }));

  const contextualLayer = [
    ...evidence.blockers.map((summary) => ({ summary })),
    ...context.contextualFlags.map((summary) => ({ summary }))
  ];

  if (drift.detected) {
    contextualLayer.push({
      summary: `Mid-session drift detected: ${drift.summary}`
    });
  }

  const strongReasons = [
    ...evidence.blockers.slice(0, 2),
    ...ruleLayer.slice(0, 2).map((item) => item.summary),
    ...statisticalLayer.slice(0, evidence.sufficient ? 2 : 1).map((item) => item.summary),
    ...contextualLayer
      .map((item) => item.summary)
      .filter((summary) => !evidence.blockers.includes(summary))
      .slice(0, evidence.sufficient ? 2 : 1)
  ];

  const reasons = [...new Set(strongReasons.filter(Boolean))].slice(0, 4);

  return {
    layers: {
      rule: ruleLayer,
      statistical: statisticalLayer,
      contextual: contextualLayer
    },
    reasons,
    interpretation: buildInterpretation(scoring.automationRisk, evidence),
    counterfactuals: buildCounterfactuals(detection, baseline),
    summaryText: `Human Likelihood: ${formatPercent(scoring.humanLikelihood)} | Automation Risk: ${formatPercent(scoring.automationRisk)} | Confidence: ${scoring.confidenceLabel} | Evidence: ${evidence.qualityLabel}`,
    exampleOutput: {
      confidence: `${scoring.confidenceLabel} (${formatNumber(scoring.confidence, 2)})`,
      sequence: sequence.path.join(" -> ")
    }
  };
}

module.exports = {
  buildExplainability
};
