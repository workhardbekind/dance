# StageCall — Dance Competition Scheduler

A real-time competition schedule manager built for dance parents. Create an event, add your dancer's routines, and share a live program link with family — no accounts required.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/workhardbekind)

---

## Features

- **Schedule management** — Create events, add routines with time, style, order number, stage, and notes
- **Live share page** — Public URL (no login) that guests can view on their phone; updates in real time
- **Custom slugs** — Replace the random token with a memorable URL like `/share/spring-showcase-2025`
- **Awards tracking** — Record Platinum / Gold / Silver / Bronze and custom awards per routine
- **Bulk time shift** — Slide the entire schedule ±15 min or ±1 hr with one click
- **Media gallery** — Host and guests can upload photos & videos (up to 2 GB each); viewable in a full-screen lightbox
- **"I'm seated" alerts** — Guests tap a button on the share page to notify you they've found their seat
- **Pushover notifications** — Get a push notification 15 minutes before each routine
- **Real-time sync** — All open tabs and devices update instantly via Socket.io

---

## Quick Start

```bash
git clone https://github.com/your-username/stagecall.git
cd stagecall
npm install
node server.js
# → http://localhost:3026
```

---

## Usage

### Admin (you)
1. Open `http://localhost:3026`
2. Click **New Event** and fill in the competition details
3. Open the event and add routines under the **Schedule** tab
4. Share the event link from the **Settings** tab or the nav bar

### Guests (family & friends)
- Open the share link on their phone — no app or account needed
- See the live schedule with countdown timers
- Upload photos and videos to the shared gallery
- Tap **I'm in my seat!** to send you a notification

---

## Pushover Notifications

Get push alerts 15 minutes before each routine and when a guest is seated.

1. Sign up at [pushover.net](https://pushover.net)
2. Create an app at [pushover.net/apps/build](https://pushover.net/apps/build) to get an **App Token**
3. Copy your **User Key** from your Pushover dashboard
4. Enter both in the **Settings** tab of any event
5. Click **Send Test** to verify

---

## Stack

| Layer | Tech |
|---|---|
| Server | Node.js + Express |
| Real-time | Socket.io |
| Styling | Tailwind CSS (CDN) |
| Storage | Flat-file JSON (`data.json`) |
| File uploads | Multer (up to 2 GB) |
| Notifications | Pushover API |

---

## Data & Files

- All event/routine/media data is stored in `data.json` (auto-created on first run)
- Uploaded files are saved to `public/uploads/`
- The server runs on port **3026** by default — set the `PORT` environment variable to change it

---

## License

MIT
