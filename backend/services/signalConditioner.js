function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  if (values.length < 2) {
    return 0;
  }

  const mean = average(values);
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function movingAverage(values, windowSize = 3) {
  if (!values.length) {
    return [];
  }

  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    return average(slice);
  });
}

function removeOutliersIqr(values) {
  if (values.length < 4) {
    return values.slice();
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
  const iqr = q3 - q1 || 1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;

  return values.filter((value) => value >= lower && value <= upper);
}

function normalize(values) {
  if (!values.length) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return values.map(() => 0.5);
  }

  return values.map((value) => (value - min) / (max - min));
}

function adaptiveSmoothing(values) {
  const signalVariance = variance(values);
  const windowSize = signalVariance > 100000 ? 5 : signalVariance > 1000 ? 4 : 3;
  const cleaned = removeOutliersIqr(values);
  return {
    windowSize,
    cleaned,
    smoothed: movingAverage(cleaned, windowSize),
    normalized: normalize(cleaned),
    variance: signalVariance
  };
}

function buildIntervals(events, type, mapper) {
  const relevant = events.filter((event) => event.type === type);
  const values = [];

  for (let index = 1; index < relevant.length; index += 1) {
    values.push(mapper(relevant[index], relevant[index - 1]));
  }

  return values;
}

function conditionSignals(events) {
  const sortedEvents = events.slice().sort((a, b) => a.timestamp - b.timestamp);
  const mouseVelocities = sortedEvents
    .filter((event) => event.type === "mousemove")
    .map((event) => Number(event.velocity || 0))
    .filter((value) => Number.isFinite(value));
  const mouseX = sortedEvents
    .filter((event) => event.type === "mousemove")
    .map((event) => Number(event.x || 0));
  const mouseY = sortedEvents
    .filter((event) => event.type === "mousemove")
    .map((event) => Number(event.y || 0));
  const scrollDeltas = sortedEvents
    .filter((event) => event.type === "scroll")
    .map((event) => Math.abs(Number(event.deltaY || 0)));
  const keyIntervals = buildIntervals(sortedEvents, "keydown", (current, previous) => current.timestamp - previous.timestamp);
  const clickIntervals = buildIntervals(sortedEvents, "click", (current, previous) => current.timestamp - previous.timestamp);
  const idleDurations = sortedEvents
    .filter((event) => event.type === "idle")
    .map((event) => Number(event.duration || 0))
    .filter((value) => value > 0);

  const signals = {
    mouseVelocities: adaptiveSmoothing(mouseVelocities),
    mouseX: adaptiveSmoothing(mouseX),
    mouseY: adaptiveSmoothing(mouseY),
    scrollDeltas: adaptiveSmoothing(scrollDeltas),
    keyIntervals: adaptiveSmoothing(keyIntervals),
    clickIntervals: adaptiveSmoothing(clickIntervals),
    idleDurations: adaptiveSmoothing(idleDurations)
  };

  const signalQuality = Object.entries(signals).reduce((quality, [key, value]) => {
    const cleanedVariance = variance(value.cleaned);
    const noiseRemoved = Math.max(0, value.variance - cleanedVariance);
    quality[key] = {
      samples: value.cleaned.length,
      variance: value.variance,
      noiseRemoved,
      normalizedMean: average(value.normalized),
      smoothness: 1 - clamp(variance(value.smoothed) / (value.variance || 1), 0, 1)
    };
    return quality;
  }, {});

  return {
    sortedEvents,
    signals,
    signalQuality
  };
}

module.exports = {
  conditionSignals,
  movingAverage,
  normalize,
  removeOutliersIqr,
  average,
  variance,
  clamp
};
