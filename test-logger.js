require('dotenv').config();
const { Log } = require('./logger');

async function testLogger() {
  console.log('Testing logger...');

  const id1 = await Log(
    "backend", "info", "middleware",
    "Logger middleware initialized successfully"
  );
  console.log('Test 1 logID:', id1);

  const id2 = await Log(
    "backend", "error", "handler",
    "received string, expected bool - type mismatch"
  );
  console.log('Test 2 logID:', id2);

  const id3 = await Log(
    "backend", "fatal", "db",
    "Critical database connection failure"
  );
  console.log('Test 3 logID:', id3);

  const id4 = await Log(
    "backend", "debug", "route",
    "Incoming GET request received at route handler"
  );
  console.log('Test 4 logID:', id4);
}

testLogger();
