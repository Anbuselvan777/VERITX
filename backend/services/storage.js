const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DEFAULT_STORAGE, DEFAULT_BASELINES } = require("./defaults");
const { createReport } = require("./analysisPipeline");

const dataDir = path.join(__dirname, "..", "..", "data");
const sessionsFile = path.join(dataDir, "sessions.json");
const baselinesFile = path.join(dataDir, "baselines.json");

let sessionsStore = null;
let baselineStore = null;
const ALLOWED_EVENT_TYPES = new Set(["mousemove", "scroll", "click", "keydown", "idle", "submit"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
  }
}

function readJson(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return clone(fallbackValue);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function initializeStorage() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  ensureFile(sessionsFile, DEFAULT_STORAGE);
  ensureFile(baselinesFile, DEFAULT_BASELINES);
  sessionsStore = readJson(sessionsFile, DEFAULT_STORAGE);
  baselineStore = readJson(baselinesFile, DEFAULT_BASELINES);
}

function persistSessions() {
  writeJson(sessionsFile, sessionsStore);
}

function persistBaselines() {
  writeJson(baselinesFile, baselineStore);
}

function getBaseline(profileId) {
  return baselineStore.profiles[profileId] || baselineStore.profiles.default;
}

function updateRunningStats(stats, value, weight = 1) {
  const next = stats
    ? { ...stats }
    : {
        count: 0,
        mean: 0,
        m2: 0,
        variance: 0,
        stdDev: 0,
        min: value,
        max: value
      };

  if (!Number.isFinite(value) || weight <= 0) {
    return next;
  }

  const repetitions = weight >= 1 ? 2 : 1;

  for (let index = 0; index < repetitions; index += 1) {
    next.count += 1;
    const delta = value - next.mean;
    next.mean += delta / next.count;
    const delta2 = value - next.mean;
    next.m2 += delta * delta2;
  }

  next.variance = next.count > 1 ? next.m2 / next.count : 0;
  next.stdDev = Math.sqrt(next.variance);
  next.min = Math.min(next.min, value);
  next.max = Math.max(next.max, value);
  return next;
}

function applyBaselineUpdate(profileId, report) {
  if (!report.evidence?.sufficient) {
    return;
  }

  const profile = baselineStore.profiles[profileId] || {
    profileId,
    sessions: 0,
    features: {}
  };
  const trustWeight =
    report.scoring.automationRisk < 0.65
      ? Math.max(0.7, report.evidence.coverageScore)
      : Math.max(0.2, report.evidence.coverageScore * 0.5);

  for (const [feature, value] of Object.entries({
    clickIntervalMean: report.features.clickIntervalMean,
    clickIntervalVariance: report.features.clickIntervalVariance,
    typingSpeed: report.features.typingSpeed,
    hesitationTime: report.features.hesitationTime,
    correctionRate: report.features.correctionRate,
    idleMean: report.features.idleMean,
    mouseMovementEntropy: report.features.mouseMovementEntropy,
    readingTime: report.features.readingTime,
    sequenceAnomaly: report.sequence.anomalyScore,
    transitionVolatility: report.sequence.transitionVolatility
  })) {
    profile.features[feature] = updateRunningStats(profile.features[feature], value, trustWeight);
  }

  profile.sessions += 1;
  profile.lastUpdatedAt = new Date().toISOString();
  baselineStore.profiles[profileId] = profile;
  persistBaselines();
}

async function startSession(payload = {}) {
  const id = crypto.randomUUID();
  const profileId = payload.profileId || "default";
  const session = {
    id,
    profileId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    metadata: payload.metadata || {},
    events: [],
    report: null
  };

  sessionsStore.sessions[id] = session;
  persistSessions();

  return {
    sessionId: id,
    profileId,
    status: session.status
  };
}

async function getSession(sessionId) {
  return sessionsStore.sessions[sessionId] || null;
}

function sanitizeTargetRole(value) {
  if (typeof value !== "string") {
    return "unknown";
  }

  return value.slice(0, 32);
}

function sanitizeNumeric(value, fallback = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(Math.max(numericValue, min), max);
}

function sanitizeEvents(events) {
  return (events || [])
    .filter((event) => event && typeof event.type === "string" && ALLOWED_EVENT_TYPES.has(event.type))
    .slice(0, 500)
    .map((event) => {
      const baseEvent = {
        type: event.type,
        timestamp: sanitizeNumeric(event.timestamp, Date.now(), 0),
        targetRole: sanitizeTargetRole(event.targetRole)
      };

      if (event.type === "mousemove") {
        return {
          ...baseEvent,
          x: sanitizeNumeric(event.x, 0, 0),
          y: sanitizeNumeric(event.y, 0, 0),
          velocity: sanitizeNumeric(event.velocity, 0, 0)
        };
      }

      if (event.type === "scroll") {
        return {
          ...baseEvent,
          deltaY: sanitizeNumeric(event.deltaY, 0),
          scrollY: sanitizeNumeric(event.scrollY, 0)
        };
      }

      if (event.type === "keydown") {
        return {
          ...baseEvent,
          key: typeof event.key === "string" ? event.key.slice(0, 24) : "",
          code: typeof event.code === "string" ? event.code.slice(0, 32) : "",
          interval: sanitizeNumeric(event.interval, 0, 0),
          isPrintable: Boolean(event.isPrintable),
          isCorrection: Boolean(event.isCorrection)
        };
      }

      if (event.type === "idle") {
        return {
          ...baseEvent,
          duration: sanitizeNumeric(event.duration, 0, 0)
        };
      }

      return baseEvent;
    })
    .filter((event) => event.timestamp >= 0)
    .sort((left, right) => left.timestamp - right.timestamp);
}

async function appendSessionEvents(sessionId, events = []) {
  const session = sessionsStore.sessions[sessionId];
  if (!session) {
    const error = new Error("Session not found");
    error.statusCode = 404;
    throw error;
  }

  session.events.push(...sanitizeEvents(events));
  session.updatedAt = new Date().toISOString();
  const baseline = getBaseline(session.profileId);
  const report = createReport(session, baseline);
  session.report = report;
  persistSessions();

  return {
    sessionId,
    status: session.status,
    report
  };
}

async function finalizeSession(sessionId, events = []) {
  const session = sessionsStore.sessions[sessionId];
  if (!session) {
    const error = new Error("Session not found");
    error.statusCode = 404;
    throw error;
  }

  if (events.length) {
    session.events.push(...sanitizeEvents(events));
  }

  session.status = "finalized";
  session.updatedAt = new Date().toISOString();
  const baseline = getBaseline(session.profileId);
  const report = createReport(session, baseline);
  session.report = report;
  applyBaselineUpdate(session.profileId, report);
  persistSessions();

  return {
    sessionId,
    status: session.status,
    report
  };
}

async function getSessionReport(sessionId) {
  return sessionsStore.sessions[sessionId]?.report || null;
}

module.exports = {
  initializeStorage,
  startSession,
  appendSessionEvents,
  finalizeSession,
  getSession,
  getSessionReport
};
