const { DEFAULT_THRESHOLDS } = require("./defaults");
const { clamp } = require("./signalConditioner");

const EXPECTED_SEQUENCE = ["READ", "PAUSE", "TYPE", "CORRECT", "SUBMIT"];

function mapEventToState(event, seenTyping) {
  if (event.type === "idle" || event.gapFromPrevious >= DEFAULT_THRESHOLDS.pauseThresholdMs) {
    return "PAUSE";
  }

  if (event.type === "submit") {
    return "SUBMIT";
  }

  if (event.type === "keydown" && event.isCorrection) {
    return "CORRECT";
  }

  if (event.type === "keydown") {
    return "TYPE";
  }

  if (!seenTyping && ["scroll", "mousemove", "click"].includes(event.type)) {
    return "READ";
  }

  return "READ";
}

function computeTransitionProbabilities(path) {
  const counts = {};
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const key = `${from}->${to}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0) || 1;
  return Object.entries(counts).reduce((probabilities, [key, count]) => {
    probabilities[key] = count / total;
    return probabilities;
  }, {});
}

function computeRepeatedPatterns(path) {
  const ngrams = {};
  for (let index = 0; index < path.length - 2; index += 1) {
    const gram = path.slice(index, index + 3).join(">");
    ngrams[gram] = (ngrams[gram] || 0) + 1;
  }

  return Object.entries(ngrams)
    .filter(([, count]) => count >= 3)
    .map(([pattern, count]) => ({ pattern, count }));
}

function analyzeSequence(events) {
  const sequence = [];
  let seenTyping = false;

  for (let index = 0; index < events.length; index += 1) {
    const current = events[index];
    const previous = events[index - 1];
    const enrichedEvent = {
      ...current,
      gapFromPrevious: previous ? current.timestamp - previous.timestamp : 0
    };
    const state = mapEventToState(enrichedEvent, seenTyping);
    if (state === "TYPE") {
      seenTyping = true;
    }
    sequence.push(state);
  }

  const compressedPath = sequence.filter((state, index) => state !== sequence[index - 1]);
  const transitionProbabilities = computeTransitionProbabilities(compressedPath);
  const repeatedPatterns = computeRepeatedPatterns(sequence);
  const missingSteps = EXPECTED_SEQUENCE.filter((state) => !compressedPath.includes(state) && state !== "CORRECT");
  const unnaturalOrder = [];
  const submitIndex = compressedPath.indexOf("SUBMIT");
  const preSubmitPath = submitIndex === -1 ? [] : compressedPath.slice(0, submitIndex);
  const submitWithoutAction = submitIndex !== -1 && preSubmitPath.length === 0;
  const submitWithoutTyping = submitIndex !== -1 && !preSubmitPath.includes("TYPE");

  if (submitIndex !== -1 && compressedPath.indexOf("TYPE") > submitIndex) {
    unnaturalOrder.push("SUBMIT occurred before TYPE.");
  }

  if (submitWithoutAction) {
    unnaturalOrder.push("SUBMIT occurred without prior interaction.");
  }

  if (submitWithoutTyping) {
    unnaturalOrder.push("SUBMIT occurred without a typing phase.");
  }

  if (compressedPath.indexOf("CORRECT") !== -1 && compressedPath.indexOf("TYPE") === -1) {
    unnaturalOrder.push("CORRECT appeared without a typing phase.");
  }

  if (compressedPath.includes("TYPE") && !compressedPath.includes("READ")) {
    unnaturalOrder.push("TYPE appeared without a preceding READ phase.");
  }

  const lowProbabilityTransitions = Object.entries(transitionProbabilities)
    .filter(([, value]) => value < 0.08)
    .map(([key, value]) => ({ key, probability: value }));
  const transitionVolatility = 1 - Math.max(...Object.values(transitionProbabilities), 0);

  const anomalyScore = clamp(
    missingSteps.length * 0.18 +
      unnaturalOrder.length * 0.24 +
      repeatedPatterns.length * 0.16 +
      lowProbabilityTransitions.length * 0.08 +
      transitionVolatility * 0.34,
    0,
    1
  );

  return {
    rawPath: sequence,
    path: compressedPath,
    transitionProbabilities,
    repeatedPatterns,
    missingSteps,
    unnaturalOrder,
    submitWithoutAction,
    submitWithoutTyping,
    lowProbabilityTransitions,
    transitionVolatility,
    anomalyScore
  };
}

module.exports = {
  analyzeSequence
};
