// netlify/functions/daily-summary.js
// Runs every day at 9am Brussels time (UTC+2 in summer = 07:00 UTC)
// Schedule is set in netlify.toml

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase }                   = require('firebase-admin/database');
const axios                             = require('axios');

// Initialise Firebase Admin (once)
function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  return getDatabase();
}

// Send a push via OneSignal REST API
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

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

  // Bucket tasks per user
  const byUser = { pini: [], ayala: [] };

  Object.values(tasks).forEach(task => {
    if (task.archived) return;

    // Include: tasks due today OR tasks with no due date
    const dueDate = task.due ? task.due.split('T')[0] : null;
    if (dueDate && dueDate !== todayStr) return;

    if (task.who === 'pini'  || task.who === 'both') byUser.pini.push(task);
    if (task.who === 'ayala' || task.who === 'both') byUser.ayala.push(task);
  });

  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;

  for (const [user, userTasks] of Object.entries(byUser)) {
    if (userTasks.length === 0) continue;

    const name  = user === 'pini' ? 'Pini' : 'Ayala';
    const count = userTasks.length;
    const list  = userTasks.slice(0, 5).map(t => `• ${t.title}`).join('\n');
    const extra = count > 5 ? `\n…and ${count - 5} more` : '';

    await sendPush({
      appId, apiKey,
      filters: [{ field: 'tag', key: 'user', relation: '=', value: user }],
      title: `Good morning ${name} ☀️ — ${count} task${count > 1 ? 's' : ''} today`,
      body:  list + extra
    });
  }

  return { statusCode: 200, body: 'Daily summary sent' };
};
