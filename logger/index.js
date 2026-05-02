const axios = require('axios');

const LOG_API_URL = 'http://20.207.122.201/evaluation-service/logs';

async function Log(stack, level, pkg, message) {
  try {
    const response = await axios.post(
      LOG_API_URL,
      {
        stack: stack,
        level: level,
        package: pkg,
        message: message
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.BEARER_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.logID;
  } catch (err) {
    console.error('[Logger Error]:', err.message);
  }
}

module.exports = { Log };
