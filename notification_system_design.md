# Notification System Design

## Stage 1

### Core Actions
The notification platform supports: Create, Read,
Mark as Read, Delete, and Bulk Notify all students.

### REST API Endpoints

#### 1. GET /notifications
- **Purpose**: Fetch all notifications for logged-in student
- **Headers**:
  {
    "Authorization": "Bearer <token>"
  }
- **Response 200**:
  {
    "notifications": [
      {
        "id": "uuid",
        "type": "Placement | Event | Result",
        "message": "string",
        "isRead": false,
        "createdAt": "2026-04-22T17:51:30Z"
      }
    ]
  }
- **Response 401**: { "error": "Unauthorized" }

#### 2. GET /notifications/:id
- **Purpose**: Fetch single notification
- **Headers**: { "Authorization": "Bearer <token>" }
- **Response 200**:
  {
    "id": "uuid",
    "type": "Placement",
    "message": "CSX Corporation hiring",
    "isRead": false,
    "createdAt": "2026-04-22T17:51:18Z"
  }
- **Response 404**: { "error": "Notification not found" }

#### 3. POST /notifications
- **Purpose**: Create notification (admin only)
- **Headers**:
  {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  }
- **Body**:
  {
    "studentId": "uuid",
    "type": "Placement | Event | Result",
    "message": "string"
  }
- **Response 201**:
  {
    "id": "uuid",
    "type": "Placement",
    "message": "string",
    "createdAt": "2026-04-22T17:51:30Z"
  }
- **Response 400**: { "error": "Invalid input" }

#### 4. PATCH /notifications/:id/read
- **Purpose**: Mark notification as read
- **Headers**: { "Authorization": "Bearer <token>" }
- **Response 200**: { "id": "uuid", "isRead": true }
- **Response 404**: { "error": "Notification not found" }

#### 5. DELETE /notifications/:id
- **Purpose**: Delete a notification
- **Headers**: { "Authorization": "Bearer <token>" }
- **Response 200**:
  { "message": "Notification deleted successfully" }
- **Response 404**: { "error": "Notification not found" }

#### 6. POST /notifications/notify-all
- **Purpose**: Bulk notify all 50,000 students
- **Headers**:
  {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  }
- **Body**:
  {
    "type": "Placement | Event | Result",
    "message": "string"
  }
- **Response 202**:
  { "message": "Notifications queued for all students" }

### Real-Time Mechanism: WebSockets (Socket.io)

**Why WebSockets over HTTP Polling?**
- Polling: client repeatedly asks server every N seconds
  → delayed, wastes bandwidth, unnecessary DB hits
- WebSockets: server pushes to client instantly
  → true real-time, efficient, one persistent connection

**Implementation:**
- Student joins socket room with their studentId on login
- POST /notifications
  → emit "new_notification" to that student's room only
- POST /notifications/notify-all
  → broadcast "new_notification" to ALL rooms
- Socket event payload:
  { id, type, message, createdAt }

---

## Stage 2

### Recommended Database: PostgreSQL

**Why PostgreSQL over MongoDB?**
- Notifications have fixed consistent schema
  → documents give no benefit here
- Foreign key constraint between students and
  notifications ensures referential integrity
- ACID compliance for reliable bulk inserts
  across 50,000 students
- Multi-column composite indexes perform
  better than MongoDB for this query pattern
- Built-in ENUM-like CHECK constraints
  for Placement / Event / Result types

### Schema

CREATE TABLE students (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  email      VARCHAR(255) UNIQUE NOT NULL,
  roll_no    VARCHAR(50)  UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL
             REFERENCES students(id) ON DELETE CASCADE,
  type       VARCHAR(20) NOT NULL
             CHECK (type IN ('Placement','Event','Result')),
  message    TEXT NOT NULL,
  is_read    BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Composite index for most common query
CREATE INDEX idx_student_unread
  ON notifications(student_id, is_read, created_at DESC);

-- Partial index — only unread rows (smaller, faster)
CREATE INDEX idx_unread_only
  ON notifications(student_id, created_at DESC)
  WHERE is_read = false;

### Scale Problems at 50k Students / 5M Notifications

**Problem 1: Full table scans get slow**
Fix: Composite indexes above reduce scan from
5M rows to targeted lookup in milliseconds

**Problem 2: Table becomes too large**
Fix: Partition by month:
  PARTITION BY RANGE (created_at)
  Each partition = one month of data only

**Problem 3: Read traffic overwhelms DB**
Fix: PostgreSQL read replicas
  Writes → primary DB
  Reads  → replica DB

**Problem 4: Unread count query on every load**
Fix: Cache in Redis
  Key: unread:{student_id} | TTL: 60 seconds
  Invalidate on new notification or mark-read

### SQL Queries for Each Endpoint

-- GET /notifications (paginated)
SELECT id, type, message, is_read, created_at
FROM notifications
WHERE student_id = $1
ORDER BY created_at DESC
LIMIT 20 OFFSET $2;

-- GET /notifications/:id
SELECT id, type, message, is_read, created_at
FROM notifications
WHERE id = $1 AND student_id = $2;

-- POST /notifications
INSERT INTO notifications (student_id, type, message)
VALUES ($1, $2, $3)
RETURNING id, type, message, created_at;

-- PATCH /notifications/:id/read
UPDATE notifications
SET is_read = true
WHERE id = $1 AND student_id = $2
RETURNING id, is_read;

-- DELETE /notifications/:id
DELETE FROM notifications
WHERE id = $1 AND student_id = $2;

-- POST /notifications/notify-all
INSERT INTO notifications (student_id, type, message)
SELECT id, $1, $2 FROM students;

---

## Stage 3

### Original Slow Query
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;

### Problem 1: No Index → Full Table Scan
With 5,000,000 rows, PostgreSQL checks every single
row to find matches → takes 8+ seconds

Fix:
CREATE INDEX idx_student_unread
  ON notifications(student_id, is_read, created_at DESC);

Result: Targeted index seek → ~12 milliseconds

### Problem 2: SELECT * → Fetches All Columns
Fetches large TEXT message columns even when
frontend only needs id, type, and createdAt

Fix:
SELECT id, type, message, created_at

### Problem 3: No LIMIT → Unbounded Results
A student with 10,000 unread notifications
returns ALL 10,000 rows → crashes memory

Fix:
LIMIT 20 OFFSET $2
(cursor-based pagination)

### Problem 4: Index Includes Read Rows
Standard index includes is_read=true rows
which are never queried in this pattern

Fix — Partial Index:
CREATE INDEX idx_unread_only
  ON notifications(student_id, created_at DESC)
  WHERE is_read = false;
Smaller index → fits in memory → faster

### Final Optimized Query
SELECT id, type, message, created_at
FROM notifications
WHERE student_id = $1
  AND is_read = false
ORDER BY created_at DESC
LIMIT 20 OFFSET $2;

---

## Stage 4

### Problem
Notifications fetched on every page load for
every student simultaneously → DB overwhelmed
→ slow response → bad UX

### Strategy 1: Redis Cache for Unread Count
- Cache key: unread:{student_id}
- On page load: check Redis first
- Cache miss: query DB, store in Redis TTL=60s
- Cache hit: return instantly, zero DB hit
- Invalidate: on new notification or mark-read
- Pros: eliminates most frequent DB query
- Cons: up to 60s staleness, needs Redis infra

### Strategy 2: Pagination
- Return 20 notifications per request only
- Frontend uses infinite scroll
- Pros: huge reduction in data per request
- Cons: UX change, frontend complexity increases

### Strategy 3: HTTP Caching for Read Notifications
- Read notifications rarely change
- Response header: Cache-Control: max-age=300
- Browser/CDN caches these responses
- Pros: zero DB hits for already-read content
- Cons: not suitable for real-time unread items

### Strategy 4: DB Connection Pooling
- Use pg-pool to reuse DB connections
- Prevents overhead of new connection per request
- Pros: significant performance improvement
- Cons: pool size must be tuned carefully

### Recommended Combination
Redis (unread counts) + Pagination + Connection Pooling
Handles 50,000 concurrent students without DB overload

---

## Stage 5

### Original Pseudocode Problems

function notify_all(student_ids, message):
  for student_id in student_ids:
    send_email(student_id, message)
    save_to_db(student_id, message)
    push_to_app(student_id, message)

**Problem 1: Synchronous loop over 50,000 students**
→ Blocks event loop for minutes
→ HTTP request times out (30s limit)
→ HR gets no feedback on progress

**Problem 2: No retry on send_email failure**
→ 200 students silently lost midway
→ No record of which students failed
→ No recovery mechanism whatsoever

**Problem 3: No transactional guarantee**
→ Email sent but DB insert fails
  → student notified but no record exists
→ DB insert succeeds but email fails
  → record exists but student never knew
→ Inconsistent state with no reconciliation

**Problem 4: No observability**
→ No logging of success or failure per student
→ Ops team cannot diagnose or replay failures

### Redesigned Solution: Message Queue (BullMQ)

On "Notify All" button click:
→ Enqueue one job per student (instant, non-blocking)
→ Return 202 immediately to HR
→ Worker pool processes jobs asynchronously
→ Each job: save_to_db → send_email → push_to_app
→ Failure: retry up to 3 times (exponential backoff)
→ After 3 retries: dead letter queue + ops alert

### Should DB Save and Email Happen Together?

YES but in this specific order:
1. Save to DB FIRST inside transaction (source of truth)
2. Send email AFTER commit (retry-safe if fails)
3. Never rollback DB if only email fails
   Email is eventually consistent, DB is authoritative

Why NOT wrap both in one transaction?
Email is an external side effect — you cannot
rollback a sent email. Keep DB (transactional)
and email (retry-able) concerns separate.

### Revised Pseudocode

function notify_all(student_ids, message, type):
  for student_id in student_ids:
    enqueue_job({ student_id, message, type })
  return 202 "Queued — processing in background"

worker.process(job):
  { student_id, message, type } = job.data
  try:
    BEGIN TRANSACTION
      save_to_db(student_id, message, type)
    COMMIT
    log("info", "db", "Saved for " + student_id)

    send_email(student_id, message)
    log("info", "service", "Email sent to " + student_id)

    push_to_app(student_id, message)
    log("info", "service", "App notified " + student_id)

  catch error:
    log("error", "handler", "Failed: " + student_id)
    throw error  // BullMQ auto-retries up to 3 times

---

## Stage 6

### Priority Inbox — Top N Notifications

### Priority Score Formula
typeWeight : Placement=3, Result=2, Event=1
minutesAgo : (currentTime - notificationTime) / 60000
recencyScore: 1000 / (minutesAgo + 1)
priorityScore = (typeWeight × 1000) + recencyScore

Placement always outranks Result and Event.
Among same type, more recent = higher score.

### Algorithm: Min-Heap of Size N

**Why NOT sorting?**
Sorting all M notifications = O(M log M)
Must completely re-sort when new notification arrives.
For 50,000 notifications arriving in real-time,
this is too slow and does not scale.

**Why Min-Heap?**
- Build heap over M items = O(M log N)
- Adding one new notification = O(log N)
- When N=10 and M=50,000 → dramatically faster
- Heap always maintains exactly the top N items

**How the min-heap works:**
1. Min-heap keeps LOWEST priority score at the top
2. For each incoming notification:
   - If heap.size < N → push directly
   - Else if score > heap.minimum → pop min, push new
3. After processing all M notifications:
   - Heap contains exactly the top N items
4. Extract and sort descending for display

**Handling new real-time notifications (WebSocket):**
On new "new_notification" socket event:
  1. Compute priorityScore instantly
  2. If score > current heap minimum → swap in O(log N)
  3. UI re-renders with updated top N
  No re-sorting of all M notifications needed.

### Running the Code
node priority_inbox.js 10   → top 10
node priority_inbox.js 15   → top 15
node priority_inbox.js 20   → top 20
