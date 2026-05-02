require('dotenv').config({ path: '../.env' });
const express = require('express');
const axios = require('axios');
const { Log } = require('../logger');
const { knapsack } = require('./knapsack');

const app = express();
const PORT = process.env.PORT || 3001;
const API_BASE = 'http://20.207.122.201/evaluation-service';

// Helper to always get fresh auth header
function getAuthHeader() {
  return {
    headers: {
      Authorization: `Bearer ${process.env.BEARER_TOKEN}`
    }
  };
}

// ─── Health Check ────────────────────────────────────────
app.get('/health', async (req, res) => {
  await Log(
    "backend", "info", "route",
    "Health check called on vehicle scheduling service"
  );
  res.json({ status: "ok", service: "vehicle-scheduling" });
});

// ─── Main Scheduling Route ───────────────────────────────
app.get('/vehicle-scheduling', async (req, res) => {
  await Log(
    "backend", "info", "route",
    "GET /vehicle-scheduling request received"
  );

  try {
    // ── Step 1: Fetch Depots ──────────────────────────────
    await Log(
      "backend", "info", "service",
      "Fetching depot list from evaluation API"
    );

    const depotRes = await axios.get(
      `${API_BASE}/depots`,
      getAuthHeader()
    );
    const depots = depotRes.data.depots;

    await Log(
      "backend", "info", "service",
      `Successfully fetched ${depots.length} depots from API`
    );

    // ── Step 2: Fetch Vehicles ────────────────────────────
    await Log(
      "backend", "info", "service",
      "Fetching vehicle task list from evaluation API"
    );

    const vehicleRes = await axios.get(
      `${API_BASE}/vehicles`,
      getAuthHeader()
    );
    const vehicles = vehicleRes.data.vehicles;

    await Log(
      "backend", "info", "service",
      `Successfully fetched ${vehicles.length} vehicle tasks from API`
    );

    // ── Step 3: Run Knapsack Per Depot ────────────────────
    const results = [];

    for (const depot of depots) {
      await Log(
        "backend", "debug", "service",
        `Running 0/1 knapsack for depot ID=${depot.ID} with capacity=${depot.MechanicHours} mechanic-hours`
      );

      const { selectedTasks, totalImpact, totalDuration } =
        knapsack(vehicles, depot.MechanicHours);

      await Log(
        "backend", "info", "service",
        `Depot ${depot.ID} result: selected=${selectedTasks.length} tasks, totalImpact=${totalImpact}, totalDuration=${totalDuration}hrs`
      );

      results.push({
        depot_id: depot.ID,
        mechanic_hours: depot.MechanicHours,
        selected_tasks: selectedTasks,
        total_duration: totalDuration,
        total_impact: totalImpact
      });
    }

    await Log(
      "backend", "info", "route",
      `Vehicle scheduling complete — processed ${results.length} depots successfully`
    );

    return res.status(200).json({
      success: true,
      results
    });

  } catch (error) {
    await Log(
      "backend", "error", "handler",
      `Vehicle scheduling failed: ${error.message}`
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─── Start Server ─────────────────────────────────────────
app.listen(PORT, async () => {
  await Log(
    "backend", "info", "service",
    `Vehicle scheduling service started on port ${PORT}`
  );
  console.log(`Vehicle scheduler running on port ${PORT}`);
});

module.exports = app;
