# Ant Design 6 UI Redesign

## Goal

Move the LifePlan desktop UI to Ant Design 6.6.1 while preserving all existing Tauri commands, SQLite data, page routes, and business rules. The resulting product uses a minimalist, modern, work-focused desktop presentation.

## Product Scope

The redesign covers the shared application shell, global theme, feedback surfaces, event inbox, projects, actions, and every dialog used by those pages. It does not add features or change persisted data.

## Visual System

- Use `antd@6.6.1` and `ConfigProvider` as the sole design-system baseline.
- Use `#1778FF` as the primary token, with the default light Ant Design palette for neutral, success, warning, and error states.
- Use a restrained application background (`#f5f5f5`), white primary surfaces, 6px component radii, 8px card radii, and very light borders.
- Use 32px controls through the compact component size and theme component tokens.
- Use Chinese system fonts (`PingFang SC`, `Microsoft YaHei`) before generic system fallbacks.
- Avoid decorative gradients, hero panels, and stacked cards. Each page has one page header, one compact filter bar, and one primary content surface.

## Shared Application Shell

- Replace the custom sidebar with an Ant Design `Layout.Sider` and icon `Menu`.
- Keep the narrow desktop sidebar with complete navigation labels: 160px wide at normal desktop size and collapsible only if required by smaller window widths.
- Preserve the routes `/inbox`, `/projects`, and `/actions` with the current page labels and lucide navigation icons.
- Use a light content background, 24px desktop content padding, and a maximum readable content width of 1120px.

## Shared Components and Feedback

- Replace custom buttons, inputs, selects, date inputs, text areas, tags, modal shells, alerts, empty states, and confirmations with their Ant Design counterparts.
- Use `Button` with `type="primary"` for the single primary command in a context, `type="text"` for minor inline actions, and `danger` only for irreversible commands.
- Use `Tag` for state and categorization labels. Status colors remain semantically equivalent to the existing product: blue active, green complete, gold delegated, red abandoned.
- Use `Alert` for page-level request failures and `message` for transient successful or failed mutations.
- Use `Popconfirm` for deletion and completion confirmations. Remove browser-native `confirm` and `alert` prompts.
- Use `Modal` and `Form` for all editable dialogs, with field-level validation and consistent footer actions.

## Inbox

- Render the quick event entry with `Input` and an embedded primary add button while retaining the existing immediate-submit workflow.
- Render the state filter with `Select` and display the result count using Ant Design typography.
- Render events as a single bordered list surface with thin dividers, a clear status tag, metadata line, and a right-aligned action group.
- Render the event processing flow in an Ant Design modal. The self-processing flow uses `Steps` with exactly two stages: convert to project and decompose actions.
- Render project action decomposition as compact rows using Ant Design form controls, inline validation, and icon-only deletion with `Tooltip`.

## Projects

- Preserve projects collapsed by default and use `Collapse` or an equivalent Ant Design expansion treatment for each project.
- Keep project summary, source event, progress, priority, and state visually scannable before expansion.
- Render project actions in the expanded region as compact list rows. Users can add, edit, and delete actions using Ant Design dialogs and confirmation components.
- Keep completed and abandoned projects expandable for inspection; hide add-action controls when the project is no longer active.

## Actions

- Render action filters with compact Ant Design `Select` controls.
- Render action rows with status tags, metadata, optional description, and a consistent right-side command group.
- Use Ant Design `Modal`, `Form`, `Select`, `DatePicker`, `Checkbox`, and `Input.TextArea` for create and edit workflows.
- Keep project/event relation selection behavior and every existing action lifecycle command unchanged.

## Integration and Compatibility

- Keep React 19.1.0 and Tauri 2 unchanged. Ant Design 6 supports React 18 and later and is compatible with the Windows WebView2 renderer used by Tauri.
- All dates passed to existing APIs remain `YYYY-MM-DD` strings. Ant Design date controls convert their selected date to that exact format before invoke calls.
- Existing `@tauri-apps/api` invoke protection remains unchanged; browser-only development surfaces continue to show the current desktop-client-required message.
- No network dependency is added at runtime. Ant Design assets are bundled into the desktop application.

## Validation

- `npm run build` passes with Ant Design 6 installed.
- `cargo check --manifest-path src-tauri/Cargo.toml` and `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` remain clean because the Rust layer is unchanged.
- Desktop acceptance covers navigation, event creation, event processing, project expansion, project action CRUD, action CRUD, confirmation dialogs, validation feedback, and the 1000px by 650px default window.
