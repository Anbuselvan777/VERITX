const { DEFAULT_THRESHOLDS } = require("./defaults");

function inferContext(events, features) {
  const keyEvents = events.filter((event) => event.type === "keydown");
  const clickEvents = events.filter((event) => event.type === "click");
  const scrollEvents = events.filter((event) => event.type === "scroll");
  const firstInteraction = events.find((event) => ["keydown", "click", "scroll"].includes(event.type));
  const firstTyping = keyEvents[0];
  const startTimestamp = events[0]?.timestamp || Date.now();
  const timeSpentBeforeInteraction = firstInteraction ? firstInteraction.timestamp - startTimestamp : 0;

  const readingPhase = {
    active: features.values.readingTime >= DEFAULT_THRESHOLDS.suspiciousReadingMs || scrollEvents.length > 0,
    durationMs: features.values.readingTime,
    signals: [
      scrollEvents.length ? "scrolling observed before input" : null,
      features.values.hesitationTime > 0 ? "pre-typing hesitation present" : null
    ].filter(Boolean)
  };

  const typingPhase = {
    active: keyEvents.length > 0,
    durationMs: firstTyping && keyEvents[keyEvents.length - 1]
      ? keyEvents[keyEvents.length - 1].timestamp - firstTyping.timestamp
      : 0,
    burstiness: features.values.keyIntervalVariance > 0 ? features.values.keyIntervalMean / Math.sqrt(features.values.keyIntervalVariance) : 0
  };

  const interactionType =
    keyEvents.length >= clickEvents.length && keyEvents.length > 0 ? "input" : clickEvents.length > 0 ? "navigation" : "observation";

  const tags = [];
  const contextualFlags = [];

  if (
    features.values.typingSpeed >= DEFAULT_THRESHOLDS.fastTypingCps &&
    features.values.readingTime >= DEFAULT_THRESHOLDS.expertReadingMs
  ) {
    tags.push("expert");
  }

  if (
    features.values.typingSpeed >= DEFAULT_THRESHOLDS.fastTypingCps &&
    features.values.readingTime < DEFAULT_THRESHOLDS.suspiciousReadingMs
  ) {
    tags.push("suspicious");
    contextualFlags.push("Fast typing occurred without a meaningful reading phase.");
  }

  if (features.values.hesitationTime <= DEFAULT_THRESHOLDS.noHesitationMs && keyEvents.length > 0) {
    contextualFlags.push("Typing began with almost no hesitation.");
  }

  if (features.values.correctionRate <= DEFAULT_THRESHOLDS.correctionFloor && keyEvents.length > 4) {
    contextualFlags.push("No correction behavior was observed despite sustained typing.");
  }

  return {
    readingPhase,
    typingPhase,
    interactionType,
    timeSpentBeforeInteraction,
    tags,
    contextualFlags,
    suspicionScore: tags.includes("suspicious") ? 0.78 : contextualFlags.length ? 0.45 : 0.2
  };
}

module.exports = {
  inferContext
};
