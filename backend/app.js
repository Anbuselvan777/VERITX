const express = require("express");
const path = require("path");
const {
  initializeStorage,
  startSession,
  appendSessionEvents,
  finalizeSession,
  getSession,
  getSessionReport
} = require("./services/storage");

const app = express();
const frontendPath = path.join(__dirname, "..", "frontend");
const chartVendorPath = path.join(__dirname, "..", "node_modules", "chart.js", "dist");

initializeStorage();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use("/vendor", express.static(chartVendorPath, { maxAge: "7d", fallthrough: false }));
app.use(express.static(frontendPath, { maxAge: "1h" }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "veritx",
    timestamp: new Date().toISOString()
  });
});

app.post("/api/sessions/start", async (req, res, next) => {
  try {
    const session = await startSession(req.body || {});
    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:sessionId/events", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { events = [] } = req.body || {};
    const result = await appendSessionEvents(sessionId, events);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:sessionId/finalize", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { events = [] } = req.body || {};
    const result = await finalizeSession(sessionId, events);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions/:sessionId", async (req, res, next) => {
  try {
    const session = await getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json(session);
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions/:sessionId/report", async (req, res, next) => {
  try {
    const report = await getSessionReport(req.params.sessionId);
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    res.json(report);
  } catch (error) {
    next(error);
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.statusCode || 500).json({
    error: error.message || "Unexpected server error"
  });
});

module.exports = app;
