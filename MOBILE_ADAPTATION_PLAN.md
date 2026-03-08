# FLEETCOM: Mobile Adaptation Plan

## 1. UI/UX Mobile Best Practices & Core Principles

Transitioning a dense, desktop-first tactical interface to mobile requires strict adherence to mobile UX principles:

*   **Fitts's Law & Tap Targets:** Touch interactions are much less precise than a mouse pointer. All interactive elements (map tracks, buttons) must have a minimum hit area of 44x44 pixels (Apple HIG) or 48x48 dp (Material Design).
*   **Progressive Disclosure:** Desktop interfaces show all information simultaneously (Tote, Logs, Map). On mobile, we must prioritize the Map. Secondary information (Logs, Track Lists) should be hidden off-screen (drawers) or collapsed, revealed only when requested.
*   **Contextual UI:** Instead of a static action bar, the UI should dynamically adapt. If no track is selected, don't show engagement options. If a friendly track is selected, don't show weapons.
*   **Ergonomics (The "Thumb Zone"):** Critical actions (Engage, Drop, IFF) should be placed at the bottom or lower-sides of the screen where thumbs naturally rest.
*   **Standardized Gestures:** Users expect maps to work like Google/Apple Maps. Single-finger drag to pan, two-finger pinch to zoom. Modifier keys (Shift, Ctrl) do not exist and must be replaced with UI toggles or time-based gestures (Long-Press).

---

## 2. Layout Architecture Refactor

### A. Viewport & Orientation
*   **Omni-Directional Playability:** The game must be fully playable in both Portrait and Landscape orientations. We will not force the user to rotate their device. The UI must dynamically stack or collapse to accommodate narrow vertical screens just as well as wide horizontal ones.
*   **Fullscreen & Safe Areas:** Implement `viewport-fit=cover` and handle `env(safe-area-inset-*)` to ensure UI elements aren't hidden under camera notches or rounded corners.

### B. HUD / Top Status Bar
*   **Condensation:** Convert text-heavy inventory labels (`PAC-3: 32/32`) into dense iconography (e.g., `[Icon] 32`).
*   **Overflow:** Move the System Clock and less critical status indicators into a collapsible menu or dropdown.

### C. Replacing Draggable Windows
Draggable windows are an anti-pattern on mobile.
*   **Track Summary & Logs (Left Window):** Convert this into a **Slide-out Side Drawer**. A small persistent button on the left edge will open it, sliding over the map.
*   **Tactical Tote (Right Window):** Convert this into a **Bottom Sheet**. When a track is "hooked", this sheet slides up from the bottom, presenting the track data. It can be swiped down to dismiss (which also unhooks the track).

### D. Action Bar (Soft Keys) & Contextual Commands
*   **Fundamental Reinvestigation:** The current static row of soft keys (1-7) takes up too much vertical space and feels cluttered on narrow portrait screens. We need a modern mobile C2 approach.
*   **Dynamic Action Contexts:** The action bar should fundamentally change depending on the state of the game:
    *   *Default State:* High-level toggles (WCS, Doctrine, Filters).
    *   *Hostile Hooked:* Weapon assignments (THAAD, PAC-3, TAMIR).
    *   *Fighter Hooked:* Vectoring commands, RTB, Intercept assignments.
*   **The "Action FAB" (Floating Action Button):** Consider replacing the bottom bar entirely with a contextual FAB in the bottom right (thumb zone) that expands into a radial or vertical speed-dial menu based on what is currently selected on the map.

---

## 3. Map & Touch Interactions

### A. Navigation Gestures
*   **Pinch-to-Zoom:** Utilize the `PointerEvent` API to track multiple concurrent pointers. Calculate the distance between two `pointerId`s to scale the map, replacing the `onWheel` desktop logic.
*   **Touch Action:** Apply `touch-action: none` to the main map container to completely disable the browser's native pull-to-refresh, pinch-zoom, and scrolling, allowing the game to handle all inputs.

### B. Selection Mechanics
*   **Expanded Hitboxes:** Add transparent, larger `<circle>` elements around the `<TrackSymbol>` components to massively increase their clickable area without changing their visual size.
*   **Marquee (Box) Selection:** 
    *   *Desktop:* `Shift + Drag`
    *   *Mobile Solution:* Add a "Multi-Select" toggle switch to the UI. When active, dragging on the map creates the selection box instead of panning the camera. Alternatively, implement a "Long-Press" (500ms delay) to anchor the box, followed by a drag.

### C. Vectoring (Fighter Control) - Comprehensive Mobile Review
*   Currently, clicking "Vector" makes the next click set a waypoint. On mobile, this two-step "ghost state" is highly error-prone because users accidentally drag the map when trying to place the waypoint.
*   **New Vectoring Paradigm:** 
    *   Instead of tapping the map to place a waypoint, provide an explicit "Move Here" button that appears wherever the user long-presses.
    *   *Or:* Allow users to literally drag the fighter symbol itself to draw a new path, locking map panning while a fighter is being dragged.
    *   We need a clear screen-wide visual state (e.g., an animated border or a dark vignette) indicating the UI is waiting for a coordinate input, so the user knows map dragging is temporarily disabled.

---

## 4. Component Refactoring & Implementation Phases

**Phase 1: Viewport & CSS Foundations**
1. Update `index.html` meta tags for standalone/fullscreen mobile behavior.
2. Add safe-area padding to headers and footers.
3. Ensure UI stacks correctly in vertical (Portrait) orientations.

**Phase 2: Touch Gestures & Map Control**
1. Refactor `App.tsx` pointer event handlers (`onPointerDown`, `onPointerMove`, `onPointerUp`) to track active pointers in a Map or Array.
2. Implement the math for pinch-to-zoom using vector distance.
3. Increase SVG hit target radii.

**Phase 3: UI Panels (Replacing Windows)**
1. Create a `SideDrawer` component for the System Logs and Track Table.
2. Create a `BottomSheet` component for the Hooked Track Tote.
3. Update Tailwind classes to hide `DraggableWindow` on screens `< 1024px`, and show the mobile alternatives.

**Phase 4: Action Bar Re-architecture & Vectoring**
1. Design and implement the new Contextual Action Bar or FAB system.
2. Completely overhaul the Fighter Vectoring UX for touch, implementing explicit visual states and drag-to-path mechanics to prevent panning collisions.
3. Refactor `BriefingModal` and `AfterActionReport` to use single-column layouts via Tailwind (`flex-col` on mobile, `md:grid-cols-2` on desktop).