/**
 * 0/1 Knapsack - Bottom-up Dynamic Programming
 * Finds optimal subset of vehicle tasks maximizing
 * impact score within mechanic-hour budget
 *
 * @param {Array} tasks - [{ TaskID, Duration, Impact }]
 * @param {number} capacity - MechanicHours for this depot
 * @returns {{ selectedTasks, totalImpact, totalDuration }}
 */
function knapsack(tasks, capacity) {
  const n = tasks.length;

  // Build 2D DP table
  // table[i][w] = max impact using first i tasks with capacity w
  const table = [];
  for (let i = 0; i <= n; i++) {
    table[i] = new Array(capacity + 1).fill(0);
  }

  // Fill DP table bottom-up
  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = tasks[i - 1];
    for (let w = 0; w <= capacity; w++) {
      if (Duration > w) {
        // Cannot include this task
        table[i][w] = table[i - 1][w];
      } else {
        // Max of: skip task OR include task
        table[i][w] = Math.max(
          table[i - 1][w],
          table[i - 1][w - Duration] + Impact
        );
      }
    }
  }

  // Backtrack to find which tasks were selected
  const selectedTasks = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (table[i][w] !== table[i - 1][w]) {
      selectedTasks.push(tasks[i - 1].TaskID);
      w -= tasks[i - 1].Duration;
    }
  }

  const totalImpact = table[n][capacity];
  const totalDuration = tasks
    .filter(t => selectedTasks.includes(t.TaskID))
    .reduce((sum, t) => sum + t.Duration, 0);

  return { selectedTasks, totalImpact, totalDuration };
}

module.exports = { knapsack };
