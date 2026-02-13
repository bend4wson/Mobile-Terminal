# Feature: Mobile Touch Improvements

**Status:** Complete

## What

Enable terminal scrollback on mobile via touch scrolling, and prevent the on-screen keyboard from opening when tapping shortcut bar buttons.

## Why

Currently on mobile, terminal output cannot be scrolled — users can't see anything that scrolled off-screen. Additionally, tapping shortcut buttons (Ctrl+C, arrows, etc.) triggers the mobile keyboard to open, which resizes the terminal and disrupts the experience. These two issues make the app frustrating to use on phones.

## Where

| File | Action |
|------|--------|
| `client/css/style.css` | Modify — adjust `touch-action` on terminal container to allow vertical scrolling |
| `client/js/shortcuts.js` | Modify — prevent keyboard focus when tapping shortcut buttons |
| `client/js/terminal.js` | Modify — configure xterm.js to handle touch scrolling properly |

## How

**Terminal scrolling:**
- Remove `touch-action: none` from `.terminal-container` — this was blocking all touch gestures including scroll
- Set `touch-action: pan-y` instead — allows vertical swipe to scroll while preventing horizontal panning and zoom
- xterm.js has built-in scrollback support (already set to 5000 lines) — the issue is purely that CSS was blocking the touch gesture

**Shortcut buttons not opening keyboard:**
- The keyboard opens because tapping a button causes the terminal's hidden textarea to lose and regain focus, or the browser interprets the tap as a text input intent
- Fix: call `e.preventDefault()` on `touchstart` (not just `click`) on shortcut buttons to prevent the browser from triggering focus changes
- After sending the input, re-focus the terminal's xterm instance without triggering the keyboard by using `{ preventScroll: true }` options

## Tasks

- [x] 1. Update `.terminal-container` CSS from `touch-action: none` to `touch-action: pan-y`
- [x] 2. Update shortcut buttons to intercept `touchstart` and prevent keyboard popup
- [x] 3. Test build compiles cleanly

## Risks

- Changing `touch-action` might allow unwanted gestures — `pan-y` should be safe since we only want vertical scrolling
- xterm.js handles its own touch events internally — need to make sure we don't conflict with its gesture handling
