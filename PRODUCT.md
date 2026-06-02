# Product

## Register

product

## Users

Fleet operators and integration/commissioning engineers at ATP and its customer
sites. They watch a floor of autonomous mobile robots (AMRs/AGVs) in real time
from a control-room or laptop, usually on a wide desktop display under bright
factory/office light. Their job: see where every robot is, dispatch and monitor
storage pickup/dropoff missions, spot traffic/alarms early, and read map
geometry (nodes, lanes, charge docks) while commissioning. Bilingual EN/TH.

## Product Purpose

A real-time Fleet Management "Digital Twin" for ATP's AMRs. The browser speaks
VDA5050 v2.0 over MQTT and renders robots on a hand-drawn 2D canvas map built
from the ATP map format. A built-in simulator drives the whole UI with no
broker, so the same panels work in SIM or LIVE. Success = an operator trusts the
map at a glance: position, status, congestion, and mission state are legible in
under a second, and map-geometry tools stay out of the way until needed.

## Brand Personality

Precise, calm, industrial. Three words: instrument-grade, legible, unfussy. It
should feel like a control panel an operator relies on for a full shift, not a
consumer app. Light "Andon" factory theme (named after the andon board on a
production line): white/near-white surfaces, restrained blue accent, semantic
status colors that mean exactly one thing each.

## Anti-references

- Consumer dark "cyber HUD" dashboards (neon glows, gradients) — the project
  deliberately moved away from this on 2026-06-01.
- Decorative SaaS marketing polish: gradient text, glassmorphism, oversized
  rounded cards, hero-metric templates.
- Emoji used as functional UI iconography (inconsistent across platforms/DPI).
- Anything that adds chrome at the expense of map legibility.

## Design Principles

1. **The map is the product.** Every pixel of UI chrome justifies itself against
   map legibility; when in doubt, recede.
2. **Status color is a vocabulary, not decoration.** A color means one robot/
   mission state (see `STATUS_COLOR`); never reuse those hues ornamentally.
3. **Instrument density, not clutter.** Operators want a lot on screen; achieve
   it through consistent compact components, not shrinking everything.
4. **One component vocabulary.** A button, toggle, or floating panel looks and
   behaves the same everywhere on the surface.
5. **SIM and LIVE are indistinguishable to the UI.** Visual treatments key off
   robot/mission state, never the data source.

## Accessibility & Inclusion

WCAG 2.1 AA contrast as the floor (body text ≥4.5:1; the bright-room context
makes low-contrast gray-on-tint a real failure, not a theoretical one). Status
must never be conveyed by color alone — pair with label/shape/icon for color
deficiency. Respect `prefers-reduced-motion`. Keyboard-focusable controls with
visible focus rings.
