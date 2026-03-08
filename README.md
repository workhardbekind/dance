# StageCall — Dance Competition Scheduler

A real-time competition schedule manager for dance parents.

## Features
- 📅 Create events and manage dancer routine schedules
- 🔗 Public sharing links (read-only view, no login required)
- 📸 Upload & share photos and videos
- 🔔 Pushover notifications 15 minutes before each routine
- ⚡ Real-time sync via Socket.io (all viewers update instantly)
- ✏️  Full edit/delete for events, routines, and media

## Setup

```bash
npm install
node server.js
# → http://localhost:3000
```

## Pushover Notifications
1. Sign up at https://pushover.net
2. Create an application at https://pushover.net/apps/build to get an **App Token**
3. Find your **User Key** on your Pushover dashboard
4. Enter both in the Settings tab of any event
5. Use "Send Test" to verify — you'll get alerts 15 min before each routine

## Share Links
- Each event has a unique public URL
- Share via the "Share" button or Settings tab
- Recipients see a read-only competition program page

## Data
- All data stored in `data.json` (auto-created)
- Uploaded media stored in `public/uploads/`
