const { average, variance, clamp } = require("./signalConditioner");

function percentile(values, ratio) {
  if (!values.length) {
    return 0;
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function entropy(values) {
  if (!values.length) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) {
    return 0;
  }

  return values.reduce((score, value) => {
    if (value <= 0) {
      return score;
    }

    const probability = value / total;
    return score - probability * Math.log2(probability);
  }, 0);
}

function computeMouseMovementEntropy(mouseEvents) {
  if (mouseEvents.length < 3) {
    return 0;
  }

  const bins = new Array(8).fill(0);
  for (let index = 1; index < mouseEvents.length; index += 1) {
    const deltaX = mouseEvents[index].x - mouseEvents[index - 1].x;
    const deltaY = mouseEvents[index].y - mouseEvents[index - 1].y;
    const angle = Math.atan2(deltaY, deltaX);
    const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
    const bucket = Math.floor((normalized / (Math.PI * 2)) * bins.length) % bins.length;
    bins[bucket] += Math.hypot(deltaX, deltaY);
  }

  return entropy(bins);
}

function computeHesitationTime(events) {
  const firstTyping = events.find((event) => event.type === "keydown");
  if (!firstTyping) {
    return 0;
  }

  const earlierContextEvent = events
    .filter((event) => event.timestamp < firstTyping.timestamp && ["scroll", "mousemove", "idle"].includes(event.type))
    .slice(-1)[0];
  const startTimestamp = earlierContextEvent ? earlierContextEvent.timestamp : events[0]?.timestamp || firstTyping.timestamp;
  return firstTyping.timestamp - startTimestamp;
}

function extractFeatures(events, conditionedSignals) {
  const mouseEvents = events.filter((event) => event.type === "mousemove");
  const keyEvents = events.filter((event) => event.type === "keydown");
  const charKeyEvents = keyEvents.filter((event) => event.isPrintable);
  const correctionEvents = keyEvents.filter((event) => event.isCorrection);
  const clickEvents = events.filter((event) => event.type === "click");
  const idleEvents = events.filter((event) => event.type === "idle");
  const scrollEvents = events.filter((event) => event.type === "scroll");
  const submitEvents = events.filter((event) => event.type === "submit");
  const startTime = events[0]?.timestamp || Date.now();
  const endTime = events[events.length - 1]?.timestamp || startTime;
  const durationMs = Math.max(1, endTime - startTime);
  const typingWindowMs = Math.max(
    1,
    (charKeyEvents[charKeyEvents.length - 1]?.timestamp || startTime) - (charKeyEvents[0]?.timestamp || startTime)
  );

  const clickIntervals = conditionedSignals.signals.clickIntervals.cleaned;
  const idleDurations = conditionedSignals.signals.idleDurations.cleaned;
  const keyIntervals = conditionedSignals.signals.keyIntervals.cleaned;
  const mouseVelocity = conditionedSignals.signals.mouseVelocities.cleaned;

  const typingSpeed = charKeyEvents.length / (typingWindowMs / 1000 || 1);
  const hesitationTime = computeHesitationTime(events);
  const correctionRate = correctionEvents.length / Math.max(1, keyEvents.length);
  const readingTime = Math.max(
    0,
    (keyEvents[0]?.timestamp || clickEvents[0]?.timestamp || startTime) - startTime
  );

  const idleDistribution = {
    short: idleDurations.filter((value) => value < 1500).length,
    medium: idleDurations.filter((value) => value >= 1500 && value < 4000).length,
    long: idleDurations.filter((value) => value >= 4000).length,
    mean: average(idleDurations),
    p90: percentile(idleDurations, 0.9)
  };

  const featureValues = {
    clickIntervalMean: average(clickIntervals),
    clickIntervalVariance: variance(clickIntervals),
    typingSpeed: Number.isFinite(typingSpeed) ? typingSpeed : 0,
    hesitationTime,
    correctionRate,
    idleMean: idleDistribution.mean,
    mouseMovementEntropy: computeMouseMovementEntropy(mouseEvents),
    readingTime,
    keyIntervalMean: average(keyIntervals),
    keyIntervalVariance: variance(keyIntervals),
    scrollIntensity: average(conditionedSignals.signals.scrollDeltas.cleaned),
    mouseVelocityMean: average(mouseVelocity),
    mouseVelocityVariance: variance(mouseVelocity),
    interactionDensity: events.length / (durationMs / 1000 || 1)
  };

  const featureVarianceMap = {
    clickIntervalMean: variance(clickIntervals),
    clickIntervalVariance: variance([featureValues.clickIntervalVariance, featureValues.clickIntervalMean]),
    typingSpeed: variance(keyIntervals),
    hesitationTime: variance([hesitationTime, readingTime]),
    correctionRate: variance(keyIntervals),
    idleMean: variance(idleDurations),
    mouseMovementEntropy: variance(mouseVelocity),
    readingTime: variance([readingTime, durationMs]),
    keyIntervalMean: variance(keyIntervals),
    keyIntervalVariance: variance(keyIntervals),
    scrollIntensity: variance(conditionedSignals.signals.scrollDeltas.cleaned),
    mouseVelocityMean: variance(mouseVelocity),
    mouseVelocityVariance: variance(mouseVelocity),
    interactionDensity: variance([events.length, durationMs])
  };

  const timeline = events.map((event, index) => ({
    index,
    timeOffsetMs: event.timestamp - startTime,
    type: event.type,
    severityHint: clamp(
      (event.type === "idle" ? 0.25 : 0) +
        (event.isCorrection ? 0.15 : 0) +
        (event.type === "submit" ? 0.4 : 0),
      0,
      1
    )
  }));

  return {
    values: featureValues,
    support: {
      totalEvents: events.length,
      clickIntervals: clickIntervals.length,
      keyIntervals: keyIntervals.length,
      idleDurations: idleDurations.length,
      mouseMoves: mouseEvents.length,
      printableKeys: charKeyEvents.length,
      keys: keyEvents.length,
      clicks: clickEvents.length,
      scrolls: scrollEvents.length,
      submits: submitEvents.length,
      meaningfulActions: mouseEvents.length + keyEvents.length + clickEvents.length + scrollEvents.length
    },
    featureVarianceMap,
    idleDistribution,
    sessionStats: {
      totalEvents: events.length,
      totalClicks: clickEvents.length,
      totalKeys: keyEvents.length,
      totalScrolls: scrollEvents.length,
      totalMouseMoves: mouseEvents.length,
      totalIdleSegments: idleEvents.length,
      totalSubmits: submitEvents.length,
      distinctEventTypes: new Set(events.map((event) => event.type)).size,
      durationMs
    },
    visualSignals: {
      clickIntervals,
      keyIntervals,
      idleDurations,
      mouseVelocity,
      timeline
    }
  };
}

module.exports = {
  extractFeatures
};
