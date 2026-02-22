# Phase 6 - PWA Polish and UX Refinements

Status: NOT STARTED

## Goal

Finalize installability, offline behavior, and UX polish decisions.

## 6a - PWA Manifest and Installability

- [ ] Confirm manifest completeness (name/short name/description/icons/theme)
- [ ] Validate iOS and Android install flows
- [ ] Validate standalone display behavior

## 6b - Service Worker and Caching

- [ ] Finalize `vite-plugin-pwa` setup
- [ ] Precache app shell assets
- [ ] Keep API calls network-first
- [ ] Add update-available prompt flow

## 6c - Mobile UX Polish

- [ ] Safe area insets and tab/input overlap checks
- [ ] Overscroll behavior review
- [ ] Keyboard + input ergonomics on Chat screen

## 6d - Product UX Refinements (from current notes)

- [ ] Add dedicated OpenRouter management screen when disconnected
- [ ] Move model selector to Chat header toggle (top-right)
- [ ] Restrict model options to:
  - Sonnet 4.6 (smarter, more expensive)
  - GLM-5 (still smart, less expensive)
- [ ] Add tooltip/help text for model cost/smartness trade-off
- [ ] Rework onboarding to structured intake form + AI refinement

## 6e - Data Export and Recovery

- [ ] Export all local stores to JSON
- [ ] Validate clean import/recovery path (if in scope)

## Acceptance Criteria

- App installs cleanly and behaves predictably on mobile
- Core UX decisions above are implemented and tested

