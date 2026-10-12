# Daybook

Single-page daily app: todos (one-time / daily), tagged thoughts, reminders, and Franklin's 13 virtues tracker.
UI is one file (`public/index.html`, Tailwind + vanilla JS). Data lives in MongoDB Atlas via a small Express API (`server.js`).

## Setup

1. **Atlas**: create a free cluster → Database Access → add a user → Network Access → allow your IP (or `0.0.0.0/0` on a server) → Connect → Drivers → copy the `mongodb+srv://...` string.
2. `cp .env.example .env` and fill in `MONGODB_URI` (add `/daybook` as DB name before `?`) and a long random `JWT_SECRET`.
3. `npm install`
4. `npm start` → open http://localhost:3000, register, done.

## Features

- **Login / register** with bcrypt passwords and 30-day JWT.
- **Todos**: one-time (default) or daily. Daily todos appear every day, with a per-day tick and a 🔥 streak.
  - Preset tags: Must do, Important, Try new, Just exploring, plus your own custom tags.
  - Optional date, time, notes, checklist, and "Remind me" (creates a linked reminder).
  - Quick add: `Call bank #finance !` (`!` = Must do, `/daily` = repeat daily).
  - Filters: Today (incl. overdue), Upcoming, Daily, All open, Completed, and by tag.
- **Thoughts**: pick existing tags or create new ones while writing. Thoughts are grouped by tag in the sidebar, with search.
- **Reminders**: daily or one-time, at a set time. Each can carry an action:
  - *Write a thought with tag X* — e.g. "Daily journal, 9 PM, #daily_general". The reminder counts as done once you write a thought with that tag that day; "Write now" opens the editor with the tag pre-selected.
  - *Complete a todo*, *Review 13 virtues*, or *just remind me*.
  - Templates for one-click setup. Snooze 10 min.
- **13 Virtues**: mark each virtue followed ✓ or slipped ✗ per day. Includes the weekly focus virtue (Franklin's 13-week cycle), morning/evening reflection questions, a 7-day grid, and past-day editing.
- Dark mode, keyboard shortcuts (`N` todo, `T` thought, `1–5` views), mobile bottom nav, and JSON backup export.

## Notes

- Reminders fire while the page is open in a tab, via browser notifications and an in-app alert. Browser notifications need `localhost` or HTTPS. If the tab was closed at 9 PM, the reminder fires as soon as you open the app later that day.
- To deploy (for example on EC2): run `npm start` behind nginx with HTTPS. The server serves the page too, so it needs only one port.
