const state = {
  sessionId: null,
  capturing: false,
  buffer: [],
  eventFeed: [],
  lastMouse: null,
  lastMouseEmitAt: 0,
  lastScrollY: window.scrollY,
  lastScrollEmitAt: 0,
  lastKeyAt: 0,
  lastActivityAt: Date.now(),
  lastIdleEmitAt: 0,
  flushTimer: null,
  idleTimer: null,
  flushing: false,
  latestReport: null,
  charts: {},
  sessionStartPerf: 0
};

const dom = {
  profileId: document.getElementById("profileId"),
  liveDot: document.getElementById("liveDot"),
  sessionStatus: document.getElementById("sessionStatus"),
  sessionMeta: document.getElementById("sessionMeta"),
  generatedAt: document.getElementById("generatedAt"),
  humanLikelihood: document.getElementById("humanLikelihood"),
  automationRisk: document.getElementById("automationRisk"),
  confidenceLabel: document.getElementById("confidenceLabel"),
  contextSummary: document.getElementById("contextSummary"),
  sequenceSummary: document.getElementById("sequenceSummary"),
  interpretationSummary: document.getElementById("interpretationSummary"),
  statsSummary: document.getElementById("statsSummary"),
  ruleLayer: document.getElementById("ruleLayer"),
  statLayer: document.getElementById("statLayer"),
  contextLayer: document.getElementById("contextLayer"),
  counterfactualLayer: document.getElementById("counterfactualLayer"),
  eventFeed: document.getElementById("eventFeed"),
  responseTitle: document.getElementById("responseTitle"),
  responseBody: document.getElementById("responseBody"),
  decisionSelect: document.getElementById("decisionSelect"),
  startSessionBtn: document.getElementById("startSessionBtn"),
  finalizeBtn: document.getElementById("finalizeBtn"),
  submitObservationBtn: document.getElementById("submitObservationBtn"),
  timelineChart: document.getElementById("timelineChart"),
  timelineNote: document.getElementById("timelineNote"),
  distributionChart: document.getElementById("distributionChart"),
  distributionNote: document.getElementById("distributionNote"),
  featureChart: document.getElementById("featureChart"),
  featureNote: document.getElementById("featureNote"),
  heatmapCanvas: document.getElementById("heatmapCanvas")
};

const EVENT_STYLES = {
  mousemove: { color: "#7ce3d0", emphasis: 0.16 },
  scroll: { color: "#4dd0ff", emphasis: 0.24 },
  keydown: { color: "#ffb24d", emphasis: 0.38 },
  click: { color: "#e0ff9a", emphasis: 0.5 },
  idle: { color: "#83db92", emphasis: 0.3 },
  submit: { color: "#ff6f61", emphasis: 0.78 }
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return "0 ms";
  }

  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatSeconds(value) {
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
}

function formatVelocity(value) {
  return `${Math.round(value)} px/s`;
}

function percentile(values, ratio) {
  const sorted = safeList(values).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function summarizeSeries(values) {
  const normalized = safeList(values).filter(Number.isFinite);
  if (!normalized.length) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      p90: 0,
      max: 0
    };
  }

  const total = normalized.reduce((sum, value) => sum + value, 0);
  return {
    count: normalized.length,
    mean: total / normalized.length,
    median: percentile(normalized, 0.5),
    p90: percentile(normalized, 0.9),
    max: Math.max(...normalized)
  };
}

function formatDistributionValue(label, value) {
  return label === "Mouse velocity" ? formatVelocity(value) : formatSeconds(value);
}

function setChartNote(target, message) {
  if (target) {
    target.textContent = message;
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(path, {
    headers,
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

function setLiveState(active, label, meta) {
  dom.sessionStatus.textContent = label;
  dom.sessionMeta.textContent = meta;
  dom.liveDot.classList.toggle("live", active);
}

function appendFeedRow(event) {
  state.eventFeed.unshift(event);
  state.eventFeed = state.eventFeed.slice(0, 24);
  dom.eventFeed.replaceChildren(
    ...state.eventFeed.map((item) => {
      const row = document.createElement("div");
      row.className = "event-row";

      const type = document.createElement("strong");
      type.textContent = item.type.toUpperCase();

      const summary = document.createElement("span");
      summary.textContent = item.summary;

      row.append(type, summary);
      return row;
    })
  );
}

function renderList(target, items, fallback) {
  const values = items && items.length ? items : [fallback];
  target.replaceChildren(
    ...values.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    })
  );
}

function clearChart(chart) {
  if (!chart) {
    return;
  }

  chart.data.labels = [];
  chart.data.datasets.forEach((dataset) => {
    dataset.data = [];
    if ("pointBackgroundColor" in dataset) {
      dataset.pointBackgroundColor = [];
    }
    if ("pointBorderColor" in dataset) {
      dataset.pointBorderColor = [];
    }
    if ("rawValues" in dataset) {
      dataset.rawValues = [];
    }
  });
  chart.update("none");
}

function resizeHeatmapCanvas() {
  const canvas = dom.heatmapCanvas;
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(bounds.width || canvas.width));
  const height = Math.max(200, Math.round(bounds.height || canvas.height));
  const ratio = window.devicePixelRatio || 1;
  const scaledWidth = Math.round(width * ratio);
  const scaledHeight = Math.round(height * ratio);

  if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
  }

  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return {
    context,
    width,
    height
  };
}

function resetDashboard() {
  dom.generatedAt.textContent = "Waiting for live analysis";
  dom.humanLikelihood.textContent = "0%";
  dom.automationRisk.textContent = "0%";
  dom.confidenceLabel.textContent = "LOW";
  dom.contextSummary.textContent = "No session analyzed yet.";
  dom.sequenceSummary.textContent = "Read, pause, type, correct, and submit steps will appear here.";
  dom.interpretationSummary.textContent = "Evidence-aware explanations will update when events are processed.";
  dom.statsSummary.textContent = "No captured activity.";
  renderList(dom.ruleLayer, [], "No rule-based anomalies triggered.");
  renderList(dom.statLayer, [], "No statistical deviations exceeded the active threshold.");
  renderList(dom.contextLayer, [], "No contextual inconsistencies detected.");
  renderList(dom.counterfactualLayer, [], "No counterfactual adjustment is needed for this session.");
  setChartNote(dom.timelineNote, "Event timing and spikes will appear once the session has enough evidence.");
  setChartNote(dom.distributionNote, "Relative spread compares mean and p90 values so different signals stay readable.");
  setChartNote(dom.featureNote, "Top weighted features will appear after the optimizer scores the session.");
  clearChart(state.charts.timeline);
  clearChart(state.charts.distribution);
  clearChart(state.charts.feature);
  drawHeatmap([]);
}

function buildCharts() {
  if (!window.Chart) {
    dom.generatedAt.textContent = "Chart.js not available";
    return;
  }

  Chart.defaults.color = "#d8e8e2";
  Chart.defaults.borderColor = "rgba(141, 165, 157, 0.12)";
  Chart.defaults.font.family = '"Aptos", "Segoe UI Variable", sans-serif';
  Chart.defaults.plugins.tooltip.backgroundColor = "rgba(6, 16, 22, 0.96)";
  Chart.defaults.plugins.tooltip.borderColor = "rgba(124, 227, 208, 0.24)";
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.animation = false;

  state.charts.timeline = new Chart(dom.timelineChart, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Signal Severity",
          data: [],
          borderColor: "#7ce3d0",
          backgroundColor: "rgba(124, 227, 208, 0.16)",
          tension: 0.32,
          fill: true,
          parsing: false,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          type: "scatter",
          label: "Captured Events",
          data: [],
          parsing: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: [],
          pointBorderColor: "rgba(4, 12, 16, 0.9)",
          pointBorderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest",
        intersect: false
      },
      plugins: {
        legend: {
          display: true
        },
        tooltip: {
          callbacks: {
            label(context) {
              const raw = context.raw || {};
              if (raw.type) {
                return `${raw.type} at ${raw.x.toFixed(1)} s`;
              }

              return `Severity ${Number(raw.y || 0).toFixed(2)} at ${Number(raw.x || 0).toFixed(1)} s`;
            }
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: "Time"
          },
          ticks: {
            callback(value) {
              return `${Number(value).toFixed(Number(value) >= 10 ? 0 : 1)}s`;
            }
          }
        },
        y: {
          min: 0,
          max: 1,
          title: {
            display: true,
            text: "Severity"
          }
        }
      }
    }
  });

  state.charts.distribution = new Chart(dom.distributionChart, {
    type: "bar",
    data: {
      labels: ["Click cadence", "Key cadence", "Idle periods", "Mouse velocity"],
      datasets: [
        {
          label: "Mean vs range",
          data: [],
          rawValues: [],
          backgroundColor: "#7ce3d0",
          borderRadius: 10
        },
        {
          label: "P90 vs range",
          data: [],
          rawValues: [],
          backgroundColor: "#ffb24d",
          borderRadius: 10
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            label(context) {
              const dataset = context.dataset;
              const rawValue = dataset.rawValues?.[context.dataIndex] || 0;
              const label = context.label || "";
              return `${dataset.label}: ${formatDistributionValue(label, rawValue)}`;
            }
          }
        }
      },
      scales: {
        x: {
          min: 0,
          max: 100,
          title: {
            display: true,
            text: "Relative spread (%)"
          },
          ticks: {
            callback(value) {
              return `${value}%`;
            }
          }
        }
      }
    }
  });

  state.charts.feature = new Chart(dom.featureChart, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Importance",
          data: [],
          backgroundColor: "rgba(255, 178, 77, 0.74)",
          borderRadius: 12
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              return `Importance ${formatPercent(context.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          suggestedMax: 1,
          ticks: {
            callback(value) {
              return formatPercent(Number(value));
            }
          }
        }
      }
    }
  });
}

function drawHeatmap(points) {
  const canvas = dom.heatmapCanvas;
  const { context, width, height } = resizeHeatmapCanvas();

  context.clearRect(0, 0, width, height);

  if (!points || !points.length) {
    context.fillStyle = "rgba(141, 165, 157, 0.5)";
    context.font = '16px "Aptos", sans-serif';
    context.fillText("Move the mouse or run a simulation to populate the density map.", 28, 36);
    return;
  }

  for (const point of points.slice(-400)) {
    const x = Math.max(0, Math.min(width, (point.x / Math.max(window.innerWidth, 1)) * width));
    const y = Math.max(0, Math.min(height, (point.y / Math.max(window.innerHeight, 1)) * height));
    const radius = Math.max(12, Math.min(42, 8 + (point.intensity || 0) / 20));
    const gradient = context.createRadialGradient(x, y, 2, x, y, radius);
    gradient.addColorStop(0, "rgba(255, 178, 77, 0.32)");
    gradient.addColorStop(0.5, "rgba(124, 227, 208, 0.18)");
    gradient.addColorStop(1, "rgba(124, 227, 208, 0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
}

function updateCharts(report) {
  if (!state.charts.timeline || !report) {
    return;
  }

  const visuals = report.visuals || {};
  const timeline = safeList(visuals.timeline);
  const timelinePoints = timeline.map((item) => ({
    x: Number(((item.timeOffsetMs || 0) / 1000).toFixed(2)),
    y: clamp(Math.max(item.severityHint || 0, EVENT_STYLES[item.type]?.emphasis || 0.08), 0, 1),
    type: item.type || "event"
  }));
  const smoothedTimeline = timelinePoints.map((point, index, list) => {
    const start = Math.max(0, index - 2);
    const slice = list.slice(start, index + 1);
    const averageY = slice.reduce((sum, item) => sum + item.y, 0) / Math.max(slice.length, 1);
    return {
      x: point.x,
      y: Number(averageY.toFixed(3))
    };
  });
  state.charts.timeline.data.datasets[0].data = smoothedTimeline;
  state.charts.timeline.data.datasets[1].data = timelinePoints;
  state.charts.timeline.data.datasets[1].pointBackgroundColor = timelinePoints.map(
    (item) => EVENT_STYLES[item.type]?.color || "#d8e8e2"
  );
  state.charts.timeline.update("none");
  if (timelinePoints.length) {
    const highestPoint = timelinePoints.reduce((top, point) => (point.y > top.y ? point : top), timelinePoints[0]);
    const totalDuration = timelinePoints[timelinePoints.length - 1].x;
    setChartNote(
      dom.timelineNote,
      `${timelinePoints.length} events mapped over ${totalDuration.toFixed(1)} s. Highest signal was a ${highestPoint.type} event.`
    );
  } else {
    setChartNote(dom.timelineNote, "Event timing and spikes will appear once the session has enough evidence.");
  }

  const distributions = visuals.distributions || {};
  const distributionSeries = [
    {
      label: "Click cadence",
      stats: summarizeSeries(distributions.clickIntervals)
    },
    {
      label: "Key cadence",
      stats: summarizeSeries(distributions.keyIntervals)
    },
    {
      label: "Idle periods",
      stats: summarizeSeries(distributions.idleDurations)
    },
    {
      label: "Mouse velocity",
      stats: summarizeSeries(distributions.mouseVelocity)
    }
  ];
  const meanDataset = state.charts.distribution.data.datasets[0];
  const p90Dataset = state.charts.distribution.data.datasets[1];
  meanDataset.data = distributionSeries.map(({ stats }) => {
    const rangeMax = Math.max(stats.max, 1);
    return Math.round((stats.mean / rangeMax) * 100);
  });
  meanDataset.rawValues = distributionSeries.map(({ stats }) => stats.mean);
  p90Dataset.data = distributionSeries.map(({ stats }) => {
    const rangeMax = Math.max(stats.max, 1);
    return Math.round((stats.p90 / rangeMax) * 100);
  });
  p90Dataset.rawValues = distributionSeries.map(({ stats }) => stats.p90);
  state.charts.distribution.update("none");
  const strongestSpread = distributionSeries.reduce(
    (top, item) => (item.stats.p90 > top.stats.p90 ? item : top),
    distributionSeries[0]
  );
  if (strongestSpread?.stats?.count) {
    setChartNote(
      dom.distributionNote,
      `${strongestSpread.label} carries the widest upper spread. Mean ${formatDistributionValue(
        strongestSpread.label,
        strongestSpread.stats.mean
      )}, p90 ${formatDistributionValue(strongestSpread.label, strongestSpread.stats.p90)}.`
    );
  } else {
    setChartNote(dom.distributionNote, "Relative spread compares mean and p90 values so different signals stay readable.");
  }

  const importance = safeList(report.optimization?.featureImportance).slice(0, 6);
  state.charts.feature.data.labels = importance.map((item) => item.feature);
  state.charts.feature.data.datasets[0].data = importance.map((item) => Number(item.weight.toFixed(3)));
  state.charts.feature.update("none");
  if (importance.length) {
    setChartNote(
      dom.featureNote,
      `${importance[0].feature} is currently the strongest driver at ${formatPercent(importance[0].weight)} importance.`
    );
  } else {
    setChartNote(dom.featureNote, "Top weighted features will appear after the optimizer scores the session.");
  }

  drawHeatmap(safeList(visuals.heatmap));
}

function renderReport(report) {
  state.latestReport = report;
  const evidence = report.evidence || {};
  const scoring = report.scoring || {};
  const context = report.context || {};
  const sequence = report.sequence || {};
  const explanation = report.explanation || {};
  const sessionStats = report.sessionStats || {};
  const contextFlagsList = safeList(context.contextualFlags);
  const sequenceWarningsList = safeList(sequence.unnaturalOrder);
  dom.generatedAt.textContent = `Updated ${formatTime(report.generatedAt)} - Evidence ${evidence.qualityLabel || "UNKNOWN"}`;
  dom.humanLikelihood.textContent = formatPercent(scoring.humanLikelihood);
  dom.automationRisk.textContent = formatPercent(scoring.automationRisk);
  dom.confidenceLabel.textContent = `${scoring.confidenceLabel || "LOW"} / ${evidence.qualityLabel || "UNKNOWN"}`;

  const contextFlags = contextFlagsList.length
    ? contextFlagsList.join(" ")
    : "Context remains within the expected interaction flow.";
  dom.contextSummary.textContent = `${String(context.interactionType || "unknown").toUpperCase()} interaction. ${evidence.summary || "Evidence is still accumulating."} ${contextFlags}`;
  const sequenceWarnings = sequenceWarningsList.length
    ? `Consistency check: ${sequenceWarningsList.join(" ")}`
    : "Flow remains logically consistent.";
  dom.sequenceSummary.textContent = safeList(sequence.path).length
    ? `${sequence.path.join(" -> ")}. ${sequenceWarnings}`
    : "No sequence pattern available yet.";
  dom.interpretationSummary.textContent = explanation.interpretation || "Evidence-aware explanations will update when events are processed.";
  dom.statsSummary.textContent = `${sessionStats.totalEvents || 0} events over ${formatMs(sessionStats.durationMs)}. ${sessionStats.totalKeys || 0} keys, ${sessionStats.totalClicks || 0} clicks, ${sessionStats.totalScrolls || 0} scrolls, ${sessionStats.totalMouseMoves || 0} mouse moves, ${sessionStats.totalSubmits || 0} submits. Coverage ${formatPercent(evidence.coverageScore)}.`;

  renderList(
    dom.ruleLayer,
    safeList(explanation.layers?.rule).map((item) => item.summary),
    "No rule-based anomalies triggered."
  );
  renderList(
    dom.statLayer,
    safeList(explanation.layers?.statistical).map((item) => item.summary),
    "No statistical deviations exceeded the active threshold."
  );
  renderList(
    dom.contextLayer,
    safeList(explanation.layers?.contextual).map((item) => item.summary),
    "No contextual inconsistencies detected."
  );
  renderList(
    dom.counterfactualLayer,
    safeList(explanation.counterfactuals).map(
      (item) => `${item.feature}: expected ${item.expected}, observed ${item.observed}. ${item.statement}`
    ),
    "No counterfactual adjustment is needed for this session."
  );

  updateCharts(report);
}

function resolveTargetRole(target) {
  if (!target) {
    return "unknown";
  }

  if (target.matches("textarea")) {
    return "textarea";
  }

  if (target.matches("input")) {
    return "input";
  }

  if (target.matches("select")) {
    return "select";
  }

  if (target.matches("button")) {
    return "button";
  }

  return target.tagName.toLowerCase();
}

function enqueueEvent(event) {
  if (!state.capturing || !state.sessionId) {
    return;
  }

  state.buffer.push(event);
  state.lastActivityAt = Date.now();
  appendFeedRow({
    type: event.type,
    summary:
      event.type === "mousemove"
        ? `(${Math.round(event.x)}, ${Math.round(event.y)}) velocity ${Math.round(event.velocity || 0)}`
        : event.type === "keydown"
          ? `key "${event.key}" interval ${Math.round(event.interval || 0)} ms`
          : event.type === "scroll"
            ? `delta ${Math.round(event.deltaY || 0)}`
            : event.type === "idle"
              ? `idle for ${Math.round(event.duration || 0)} ms`
              : `target ${event.targetRole || "n/a"}`
  });

  if (state.buffer.length >= 24) {
    flushBuffer();
  }
}

async function flushBuffer() {
  if (state.flushing || !state.buffer.length || !state.sessionId) {
    return;
  }

  state.flushing = true;
  const batch = state.buffer.splice(0, state.buffer.length);

  try {
    const result = await api(`/api/sessions/${state.sessionId}/events`, {
      method: "POST",
      body: JSON.stringify({ events: batch })
    });
    if (result.report) {
      renderReport(result.report);
    }
  } catch (error) {
    console.error(error);
    dom.sessionMeta.textContent = error.message;
  } finally {
    state.flushing = false;
  }
}

function stopTimers() {
  clearInterval(state.flushTimer);
  clearInterval(state.idleTimer);
  state.flushTimer = null;
  state.idleTimer = null;
}

async function startSession() {
  stopTimers();
  state.capturing = false;
  state.sessionId = null;
  state.buffer = [];
  state.eventFeed = [];
  dom.eventFeed.innerHTML = "";
  state.latestReport = null;
  state.lastMouse = null;
  state.lastMouseEmitAt = 0;
  state.lastScrollY = window.scrollY;
  state.lastScrollEmitAt = 0;
  state.lastKeyAt = 0;
  state.lastActivityAt = Date.now();
  state.lastIdleEmitAt = 0;
  state.sessionStartPerf = performance.now();
  resetDashboard();

  const payload = {
    profileId: dom.profileId.value.trim() || "default",
    metadata: {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      userAgent: navigator.userAgent
    }
  };

  const response = await api("/api/sessions/start", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  state.sessionId = response.sessionId;
  state.capturing = true;
  setLiveState(true, "Capturing", `Session ${response.sessionId.slice(0, 8)} - profile ${response.profileId}`);

  state.flushTimer = window.setInterval(() => {
    flushBuffer();
  }, 1200);

  state.idleTimer = window.setInterval(() => {
    if (!state.capturing) {
      return;
    }

    const now = Date.now();
    const idleDuration = now - state.lastActivityAt;
    if (idleDuration >= 1200 && now - state.lastIdleEmitAt >= 1200) {
      state.lastIdleEmitAt = now;
      enqueueEvent({
        type: "idle",
        duration: idleDuration,
        timestamp: now
      });
    }
  }, 500);
}

async function finalizeSession(addSubmitEvent = false) {
  if (!state.sessionId) {
    return;
  }

  if (addSubmitEvent) {
    enqueueEvent({
      type: "submit",
      targetRole: "button",
      timestamp: Date.now()
    });
  }

  await flushBuffer();
  const result = await api(`/api/sessions/${state.sessionId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ events: [] })
  });

  state.capturing = false;
  stopTimers();
  setLiveState(false, "Finalized", `Session ${state.sessionId.slice(0, 8)} analyzed`);
  if (result.report) {
    renderReport(result.report);
  }
}

function listenForCapture() {
  document.addEventListener(
    "mousemove",
    (event) => {
      if (!state.capturing) {
        return;
      }

      const now = Date.now();
      if (now - state.lastMouseEmitAt < 40) {
        return;
      }

      let velocity = 0;
      if (state.lastMouse) {
        const deltaX = event.clientX - state.lastMouse.x;
        const deltaY = event.clientY - state.lastMouse.y;
        const deltaT = now - state.lastMouse.timestamp || 1;
        velocity = Math.hypot(deltaX, deltaY) / deltaT * 1000;
      }

      state.lastMouse = {
        x: event.clientX,
        y: event.clientY,
        timestamp: now
      };
      state.lastMouseEmitAt = now;

      enqueueEvent({
        type: "mousemove",
        x: event.clientX,
        y: event.clientY,
        velocity,
        timestamp: now,
        targetRole: resolveTargetRole(event.target)
      });
    },
    { passive: true }
  );

  document.addEventListener("click", (event) => {
    if (!state.capturing) {
      return;
    }

    enqueueEvent({
      type: "click",
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now(),
      targetRole: resolveTargetRole(event.target)
    });
  });

  document.addEventListener(
    "scroll",
    () => {
      if (!state.capturing) {
        return;
      }

      const now = Date.now();
      if (now - state.lastScrollEmitAt < 80) {
        return;
      }

      const currentY = window.scrollY;
      const deltaY = currentY - state.lastScrollY;
      state.lastScrollY = currentY;
      state.lastScrollEmitAt = now;

      enqueueEvent({
        type: "scroll",
        deltaY,
        scrollY: currentY,
        timestamp: now,
        targetRole: "window"
      });
    },
    { passive: true }
  );

  document.addEventListener("keydown", (event) => {
    if (!state.capturing) {
      return;
    }

    const now = Date.now();
    const interval = state.lastKeyAt ? now - state.lastKeyAt : 0;
    state.lastKeyAt = now;

    enqueueEvent({
      type: "keydown",
      key: event.key,
      code: event.code,
      interval,
      isPrintable: event.key.length === 1,
      isCorrection: event.key === "Backspace" || event.key === "Delete",
      timestamp: now,
      targetRole: resolveTargetRole(event.target)
    });
  });
}

function generateScenario(kind) {
  const base = Date.now();
  const events = [];
  let offset = 0;

  const push = (type, extra = {}, increment = 120) => {
    offset += increment;
    events.push({
      type,
      timestamp: base + offset,
      ...extra
    });
  };

  const typeWord = (word, cadence, corrections = false) => {
    for (const char of word.split("")) {
      push("keydown", { key: char, code: `Key${char.toUpperCase()}`, isPrintable: true, isCorrection: false, targetRole: "textarea" }, cadence());
    }
    if (corrections) {
      push("keydown", { key: "Backspace", code: "Backspace", isPrintable: false, isCorrection: true, targetRole: "textarea" }, cadence());
      push("keydown", { key: word.slice(-1), code: `Key${word.slice(-1).toUpperCase()}`, isPrintable: true, isCorrection: false, targetRole: "textarea" }, cadence());
    }
  };

  if (kind === "human") {
    push("mousemove", { x: 220, y: 120, velocity: 140, targetRole: "article" }, 110);
    push("mousemove", { x: 260, y: 160, velocity: 170, targetRole: "article" }, 150);
    push("scroll", { deltaY: 180, scrollY: 180, targetRole: "window" }, 380);
    push("idle", { duration: 420 }, 420);
    push("mousemove", { x: 350, y: 320, velocity: 110, targetRole: "textarea" }, 210);
    typeWord("review", () => 120 + Math.round(Math.random() * 80), true);
    push("idle", { duration: 320 }, 320);
    typeWord("normal", () => 130 + Math.round(Math.random() * 90));
    push("click", { x: 500, y: 510, targetRole: "button" }, 360);
    push("submit", { targetRole: "button" }, 250);
  } else if (kind === "expert") {
    push("mousemove", { x: 240, y: 140, velocity: 150, targetRole: "article" }, 150);
    push("scroll", { deltaY: 240, scrollY: 240, targetRole: "window" }, 620);
    push("scroll", { deltaY: 220, scrollY: 460, targetRole: "window" }, 760);
    push("idle", { duration: 820 }, 820);
    push("mousemove", { x: 380, y: 280, velocity: 180, targetRole: "textarea" }, 220);
    typeWord("analysis", () => 80 + Math.round(Math.random() * 40), false);
    typeWord("expert", () => 85 + Math.round(Math.random() * 45), true);
    push("click", { x: 510, y: 515, targetRole: "button" }, 280);
    push("submit", { targetRole: "button" }, 180);
  } else {
    push("mousemove", { x: 420, y: 310, velocity: 220, targetRole: "textarea" }, 55);
    typeWord("automated", () => 35, false);
    typeWord("response", () => 35, false);
    push("click", { x: 512, y: 518, targetRole: "button" }, 220);
    push("click", { x: 512, y: 518, targetRole: "button" }, 220);
    push("submit", { targetRole: "button" }, 120);
  }

  return events;
}

async function runSimulation(kind) {
  await startSession();
  stopTimers();
  state.capturing = false;
  state.buffer = [];
  setLiveState(true, "Simulating", `Running ${kind} scenario`);
  const events = generateScenario(kind);
  state.eventFeed = [];
  dom.eventFeed.innerHTML = "";
  events.forEach((event) => {
    appendFeedRow({
      type: event.type,
      summary: `${event.type} @ ${formatTime(event.timestamp)}`
    });
  });

  await api(`/api/sessions/${state.sessionId}/events`, {
    method: "POST",
    body: JSON.stringify({ events })
  }).then((result) => {
    if (result.report) {
      renderReport(result.report);
    }
  });

  await finalizeSession(false);
}

function bindUI() {
  dom.startSessionBtn.addEventListener("click", async () => {
    try {
      await startSession();
    } catch (error) {
      console.error(error);
      dom.sessionMeta.textContent = error.message;
    }
  });

  dom.finalizeBtn.addEventListener("click", async () => {
    try {
      await finalizeSession(false);
    } catch (error) {
      console.error(error);
      dom.sessionMeta.textContent = error.message;
    }
  });

  dom.submitObservationBtn.addEventListener("click", async () => {
    try {
      if (!state.capturing) {
        await startSession();
      }
      await finalizeSession(true);
    } catch (error) {
      console.error(error);
      dom.sessionMeta.textContent = error.message;
    }
  });

  document.querySelectorAll("[data-simulate]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await runSimulation(button.dataset.simulate);
      } catch (error) {
        console.error(error);
        dom.sessionMeta.textContent = error.message;
      }
    });
  });
}

function boot() {
  setLiveState(false, "Idle", "No active session");
  buildCharts();
  resetDashboard();
  listenForCapture();
  bindUI();
  window.addEventListener("resize", () => {
    drawHeatmap(state.latestReport?.visuals?.heatmap || []);
  });
}

boot();
