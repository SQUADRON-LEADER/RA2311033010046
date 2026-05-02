require('dotenv').config();
const axios = require('axios');
const Heap = require('heap');
const { Log } = require('./logger');

const NOTIFICATION_API =
  'http://20.207.122.201/evaluation-service/notifications';

// Priority weights — Placement highest, Event lowest
const TYPE_WEIGHTS = {
  'Placement': 3,
  'Result': 2,
  'Event': 1
};

/**
 * Calculate priority score for a notification
 * Formula: (typeWeight * 1000) + recencyScore
 * recencyScore = 1000 / (minutesAgo + 1)
 * Higher score = higher priority in inbox
 */
function calculatePriorityScore(notification) {
  const typeWeight = TYPE_WEIGHTS[notification.Type] || 0;
  const minutesAgo =
    (Date.now() - new Date(notification.Timestamp).getTime())
    / 60000;
  const recencyScore = 1000 / (minutesAgo + 1);
  return (typeWeight * 1000) + recencyScore;
}

/**
 * Get top N priority notifications using Min-Heap
 *
 * Why Min-Heap and NOT sorting?
 * - Sort all M notifications: O(M log M)
 * - Must re-sort entirely on each new notification
 * - Min-Heap of size N: O(M log N)
 * - New notification arrives: O(log N) — just push/pop
 * - When N=10 and M=50000, heap is vastly faster
 */
async function getTopNNotifications(n = 10) {
  await Log(
    "backend", "info", "service",
    `Priority Inbox started — computing top ${n} notifications`
  );

  try {
    // Fetch all notifications from API
    await Log(
      "backend", "info", "route",
      "Fetching all notifications from evaluation API"
    );

    const response = await axios.get(NOTIFICATION_API, {
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`
      }
    });

    const notifications = response.data.notifications;

    await Log(
      "backend", "info", "service",
      `Fetched ${notifications.length} total notifications`
    );

    // Min-heap: keeps LOWEST priority score at top
    // This lets us efficiently evict lowest when heap is full
    const minHeap = new Heap(
      (a, b) => a.priorityScore - b.priorityScore
    );

    // Process each notification
    for (const notification of notifications) {
      const priorityScore = calculatePriorityScore(notification);
      const entry = { ...notification, priorityScore };

      await Log(
        "backend", "debug", "service",
        `Scored ${notification.ID} type=${notification.Type} score=${priorityScore.toFixed(2)}`
      );

      if (minHeap.size() < n) {
        // Heap not full yet — add directly
        minHeap.push(entry);
      } else if (priorityScore > minHeap.peek().priorityScore) {
        // New score beats current minimum — swap in
        minHeap.pop();
        minHeap.push(entry);
      }
    }

    // Extract all items sorted highest priority first
    const topN = [];
    while (minHeap.size() > 0) {
      topN.unshift(minHeap.pop());
    }

    await Log(
      "backend", "info", "service",
      `Priority Inbox complete — returning top ${topN.length} notifications`
    );

    return topN;

  } catch (error) {
    await Log(
      "backend", "error", "handler",
      `Priority Inbox failed: ${error.message}`
    );
    throw error;
  }
}

// ─── Run ──────────────────────────────────────────────────
const N = parseInt(process.argv[2]) || 10;

getTopNNotifications(N).then(results => {
  console.log(`\n========================================`);
  console.log(`  TOP ${N} PRIORITY NOTIFICATIONS`);
  console.log(`========================================\n`);

  results.forEach((notif, i) => {
    console.log(`${i + 1}. [${notif.Type}] ${notif.Message}`);
    console.log(`   ID        : ${notif.ID}`);
    console.log(`   Timestamp : ${notif.Timestamp}`);
    console.log(`   Priority  : ${notif.priorityScore.toFixed(2)}`);
    console.log('');
  });
}).catch(err => {
  console.error('Failed:', err.message);
});
