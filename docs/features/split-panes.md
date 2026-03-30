# Split Pane Terminals

**Status:** Complete

## What

Allow users to split the terminal view into multiple panes arranged in a grid, similar to iTerm2 or tmux. Each pane runs an independent terminal session. Users can drag dividers to resize panes and use buttons/gestures to split, close, or focus individual panes.

## Why

Power users often need to see multiple terminals simultaneously — monitoring logs in one pane while editing in another. Currently the app only supports tabs (one terminal visible at a time). Split panes make the app significantly more useful on iPads with large screens, and still work on iPhones for a 2-pane vertical split.

## Where

Files to create:
- `client/js/split-pane.js` — Split pane layout engine (tree-based splitter)
- `client/css/split-pane.css` — Pane borders, resize handles, focus indicators

Files to modify:
- `client/index.html` — Add split pane controls, load new scripts/styles
- `client/js/terminal.js` — Refactor to support multiple visible terminals at once (currently hides all but the active one)
- `client/js/tabs.js` — Each tab can now contain a pane layout (single pane by default)
- `client/js/shortcuts.js` — Route shortcut input to the *focused* pane, not just the current session
- `client/css/style.css` — Minor adjustments to terminal container for split mode

## How

### Layout Model

Use a **binary split tree**. Each node is either:
- A **leaf** (contains a terminal session ID)
- A **split** (has a direction `horizontal`|`vertical`, a split ratio 0–1, and two children)

```
Split(vertical, 0.5)
├── Leaf(session-1)
└── Split(horizontal, 0.5)
    ├── Leaf(session-2)
    └── Leaf(session-3)
```

This renders as:
```
┌──────────┬──────────┐
│          │ session-2│
│ session-1├──────────┤
│          │ session-3│
└──────────┴──────────┘
```

### Pane Management

- **Split active pane:** Buttons in the shortcut bar area — `[⬍]` for vertical split, `[⬌]` for horizontal split. Splitting creates a new session in the new pane.
- **Close pane:** A small `×` overlay in the top-right corner of each pane (visible on hover/tap). Closing a pane kills that session and the sibling expands to fill the space.
- **Focus pane:** Tap a pane to focus it. The focused pane gets a colored border (accent color). All keyboard input and shortcut bar buttons route to the focused pane.
- **Resize panes:** Drag the divider between panes. On touch devices, the divider has a wider hit target (16px). The divider snaps if dragged below 20% (collapses that pane).

### Rendering

Each pane is an absolutely-positioned `div` inside the terminal container. The split tree is walked to compute `{ top, left, width, height }` for each leaf, then each pane div is positioned accordingly. Dividers are thin overlay elements positioned at split boundaries.

All pane terminals use the existing `TerminalManager.getOrCreateTerminal()` and `connectWs()` — the refactor is just allowing multiple to be visible and connected simultaneously.

### State Per Tab

Each tab stores its own pane layout tree. Switching tabs swaps the entire layout. The tree is serialized to `localStorage` so layouts survive page reloads.

### Mobile Considerations

- **iPad:** Full split support — up to 4 panes comfortably in landscape
- **iPhone:** Allow vertical split only (2 panes stacked). Horizontal splits disabled when viewport width < 500px.
- **Minimum pane size:** 200px wide, 100px tall — prevents unusably small panes
- All dividers and close buttons meet 44px touch target minimum

### No Server Changes

This is entirely a frontend feature. The backend already supports multiple concurrent WebSocket connections per user. Each pane simply opens its own session.

## Tasks

1. **Create split pane layout engine** (`client/js/split-pane.js`)
   - Binary tree data structure (create, split, remove, resize)
   - Layout computation (tree → absolute positions)
   - Serialization to/from JSON for localStorage persistence

2. **Create split pane CSS** (`client/css/split-pane.css`)
   - Pane containers, focus borders, dividers, resize handles
   - Close button overlay per pane
   - Responsive rules (disable horizontal split on narrow screens)

3. **Refactor terminal.js for multi-pane**
   - Allow multiple terminals to be visible and connected simultaneously
   - Track "focused" pane separately from "current session"
   - Route input to focused pane
   - Fit each terminal to its pane size (not the full container)

4. **Integrate with tabs.js**
   - Each tab stores a pane layout tree
   - Tab switch swaps the entire layout
   - New tab starts with a single pane
   - Persist layouts in localStorage

5. **Add split/close UI controls**
   - Split buttons in shortcut bar area
   - Close button overlay on each pane
   - Divider drag-to-resize with touch support

6. **Add divider resize interaction**
   - Mouse drag and touch drag on dividers
   - Snap-to-collapse below 20% threshold
   - Re-fit terminals on resize

7. **Mobile responsiveness**
   - Disable horizontal split on narrow viewports
   - Test on iPad and iPhone form factors
   - Ensure keyboard viewport fix still works with split panes

## Risks

- **Performance:** Multiple xterm.js instances + WebSocket connections are heavier. Capped at 4 panes per tab.
- **Touch conflicts:** Divider drag vs terminal scroll vs pane focus tap need careful event handling to avoid conflicts with the existing touch scroll handler.
- **Keyboard routing:** Must be very clear which pane has focus — visual indicator is critical or users will type into the wrong terminal.
- **Small screens:** On iPhone, even 2 panes may feel cramped. The minimum size constraints should prevent unusable layouts but the UX may not be great below ~768px width.

## Implementation Notes

- Drag-and-drop uses HTML5 drag API on desktop and custom long-press + touch drag on mobile (300ms hold to initiate)
- Drop zones appear as overlays on the target pane: left/right/top/bottom edges for splits, center to replace
- On viewports < 500px wide, only vertical (top/bottom) splits are allowed
- Split pane sessions created via drag do not appear as separate tabs in the tab bar
- Layouts are persisted to localStorage and survive page reloads
- The tab ID doubles as the layout key in SplitPane
