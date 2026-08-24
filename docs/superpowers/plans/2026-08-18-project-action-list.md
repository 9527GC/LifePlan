# Project Action List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users expand a project card to inspect and manage its actions without leaving the Projects page.

**Architecture:** `Projects.tsx` loads projects and actions together, keeps expansion state local, and groups actions by `project_id`. A focused action modal handles create and edit; existing Tauri action commands remain the source of truth. `App.css` adds only the project-action presentation rules and reuses existing form/button primitives.

**Tech Stack:** React 19, TypeScript, Tauri 2 invoke API, SQLite commands, plain CSS, lucide-react.

## Global Constraints

- Projects are collapsed by default.
- New actions created from a project always receive that project's `project_id`.
- Completed or abandoned projects remain expandable for viewing but cannot add actions.
- Action titles and estimated duration are required; duration options remain 30 minutes, 1 hour, 1.5 hours, and 2 hours.
- Keep the existing blue `#1778FF` visual language and 32px control height.

---

### Task 1: Load and group project actions

**Files:**
- Modify: `src/pages/Projects.tsx`

**Interfaces:**
- Consumes: `projectsApi.list()`, `actionsApi.list()`, `Action.project_id`.
- Produces: grouped action state and project expand/collapse handlers for the page.

- [ ] Load projects and actions in one `Promise.all` call.
- [ ] Store expanded project IDs in a `Set<number>` initialized empty.
- [ ] Refresh both lists after project or action mutations.

### Task 2: Render expandable project cards

**Files:**
- Modify: `src/pages/Projects.tsx`

**Interfaces:**
- Consumes: grouped actions and project status.
- Produces: `ProjectCard` and `ProjectActionList` UI with stable project/action controls.

- [ ] Add a chevron toggle to each card while leaving the project summary compact.
- [ ] Render action rows only when the project is expanded.
- [ ] Show action status, title, duration, start date, deadline, and edit/delete controls.
- [ ] Keep completed and abandoned projects viewable and hide only their add-action control.

### Task 3: Add project-scoped action modal

**Files:**
- Modify: `src/pages/Projects.tsx`

**Interfaces:**
- Consumes: `actionsApi.create(NewAction)`, `actionsApi.update(UpdateAction)`.
- Produces: create/edit modal that pre-associates new actions with the current project.

- [ ] Reuse the existing action field conventions for title, description, duration, dates, importance, urgency, and frog flag.
- [ ] Use the same modal for create and edit while omitting relation selection.
- [ ] Refresh lists and close the modal after successful save.
- [ ] Confirm before deleting an action and surface API errors through the existing page banner.

### Task 4: Style the expanded action region

**Files:**
- Modify: `src/App.css`

- [ ] Add a lightly separated expanded section with compact action rows.
- [ ] Keep action metadata readable at the existing 1000px desktop width and stack safely on narrow screens.
- [ ] Preserve existing modal, form, and button styling.

### Task 5: Verify the feature

**Files:**
- Test: `npm run build`
- Test: `cargo check --manifest-path src-tauri/Cargo.toml`
- Test: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

- [ ] Confirm the TypeScript build passes.
- [ ] Confirm Rust commands remain unchanged and compile.
- [ ] Manually verify collapsed default, expand, add, edit, delete, and status restrictions in the desktop client.
