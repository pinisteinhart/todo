// netlify/functions/due-reminder.js
// Runs every minute via Netlify scheduled function
// Finds tasks due in the current minute and sends a push to the relevant user(s)

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase }                   = require('firebase-admin/database');
const axios                             = require('axios');

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  return getDatabase();
}

async function sendPush({ appId, apiKey, filters, title, body }) {
  await axios.post('https://onesignal.com/api/v1/notifications', {
    app_id:   appId,
    filters,
    headings: { en: title },
    contents: { en: body }
  }, {
    headers: {
      Authorization: `Basic ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
}

exports.handler = async () => {
  const db = getDb();
  const snap = await db.ref('tasks').once('value');
  const tasks = snap.val() || {};

  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;

  // Current minute window: now to now+60s
  const now     = new Date();
  const nowMs   = now.getTime();
  const plusMin = nowMs + 60 * 1000;

  for (const [taskId, task] of Object.entries(tasks)) {
    if (task.archived) continue;
    if (!task.due)     continue;

    const dueMs = new Date(task.due).getTime();

    // Fire if due time falls within this minute's window
    if (dueMs < nowMs || dueMs >= plusMin) continue;

    // Determine which users to notify
    const users = [];
    if (task.who === 'pini'  || task.who === 'both') users.push('pini');
    if (task.who === 'ayala' || task.who === 'both') users.push('ayala');

    for (const user of users) {
      await sendPush({
        appId, apiKey,
        filters: [{ field: 'tag', key: 'user', relation: '=', value: user }],
        title: `⏰ Due now: ${task.title}`,
        body:  task.desc ? task.desc : 'Tap to open your task list'
      });
    }
  }

  return { statusCode: 200, body: 'Due reminders checked' };
};
