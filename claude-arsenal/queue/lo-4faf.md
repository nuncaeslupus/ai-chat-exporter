# A11Y-1: accessibility — focus lost on every view change, drag-only reordering, missing lang, menu ARIA

Source: the 13-dimension senior review of 2026-07-31 (26 agents, findings adversarially reviewed).
**17 findings** in this task: 4 high, 10 medium, 3 low.

The focus bug is the most serious: a keyboard user changes view and focus lands on `<body>`, so they
are dropped out of the UI entirely. Filename reordering being drag-only is a WCAG 2.1.1 Level A
failure with no keyboard path at all.

---

## Findings

### [high] Popup view changes discard focus: it lands on <body>, is never moved into the new view, and is never restored on back/Escape

- **Where:** `src/extension/popup/popup.ts`:424
- **Problem:** `setView()` only flips the `hidden` attribute on the six `<section class="popup-view">` elements. The trigger that was just activated (`.setting-row[data-nav="content"]`, the Options row, the gear, `.submenu-back`, `.submenu-done`) is a descendant of the section being hidden, so the browser blurs it and focus falls back to `<body>`. Nothing in the codebase ever calls `.focus()` — `grep -rn "\.focus()" src/` returns zero hits — so no focus is placed in the new view and none is restored when navigating back. The submenu sections also have no `tabindex="-1"` target, no `aria-live`, and no `role="dialog"`, so a screen-reader user gets no announcement at all that the view changed; the visible content silently swaps under them.
- **Failure scenario:** Keyboard-only user on a ready ChatGPT page: Tab, Tab, Tab to the "Content" row, press Enter. The pair chooser opens but focus is now on `<body>`. The next Tab goes to `#header-gear` (the first focusable element in the document, in the header, outside the views) — pressing Enter there throws them into the Settings view instead of a pair checkbox. Coming back out is the same in reverse: pressing Escape (popup.ts:512-514) or activating "Done" returns to the main view with focus on `<body>`, so they must Tab from the top again to reach the Export button. A screen-reader user hears nothing when either transition happens.
- **Suggested fix:** In `setView()`, after showing the target section, move focus into it: give each `<section class="popup-view">` `tabindex="-1"` and call `document.getElementById(`view-${view}`)?.focus()` — or focus the section's `.submenu-title` h2 so the view name is announced. Additionally remember the element that triggered the navigation (`event.target.closest('[data-nav]')`) and re-focus it when `setView('main')`/`setView('options')` returns, so back/Escape restores the place the user left.

### [high] View switching never moves focus; the focused control is hidden under the keyboard user, dropping focus to <body>

- **Where:** `src/extension/popup/popup.ts`:424
- **Problem:** setView() only flips the `hidden` attribute on the six .popup-view sections and sets data-view. It never calls focus(). Every navigation trigger (the Content/Options setting rows, the gear, the drift row, the four submenu-back buttons, the Done buttons, the filename nav row) lives INSIDE the section that setView() is about to hide, and .popup-view[hidden] resolves to display:none (popup.css:462). The browser therefore blurs the activating element and resets focus to <body>. The same happens on the Escape path (popup.ts:512-514) and after picking a format row, since setFormatMenuOpen(false) display:none-s the row that was just activated. There is no focus() call anywhere in popup.ts (grep confirms zero hits) and no heading/region focus target in the new view.
- **Failure scenario:** Keyboard user on a ChatGPT chat: Tab to the "Options" row, press Enter. The Options view paints but focus is gone -- a screen reader announces nothing, and the next Tab starts from the top of the document (header gear), so the user must Tab past the header to reach the checkbox they navigated for. Pressing Escape to go back leaves focus on <body> again, with no indication the view changed. With three navigation levels (main -> Options -> File name) the user re-traverses the header on every single step.
- **Suggested fix:** In setView(), after toggling `hidden`, move focus into the newly shown view: give each view's <h2 class="submenu-title"> (and the main view's conversation title) `tabindex="-1"` and call `document.getElementById('view-' + view)?.querySelector('.submenu-title, .conversation-title')?.focus()`. For the reverse trip, remember the element that triggered navigation (`event.target.closest('[data-nav]')`) per view and restore focus to it when returning, including on the Escape path in handleRouterKeydown. Same for setFormatMenuOpen(false): return focus to #format-menu-toggle.
- **Evidence:** private setView(view: PopupView): void {
    this.view = view;
    for (const name of VIEWS) {
      const container = document.getElementById(`view-${name}`);
      if (container) container.hidden = name !== view;
    }
    this.bodyBox()?.setAttribute('data-view', view);
  }

// popup.css:462 -> .popup-view[hidden] { display: none; }
// grep -n "focus()" src/extension/popup/popup.ts -> no matches

### [high] Filename piece reordering is drag-and-drop only, with no keyboard path (WCAG 2.1.1, Level A)

- **Where:** `src/extension/popup/popup.ts`:834
- **Problem:** pieceChip() sets chip.draggable = true and wires dragstart/dragover/drop as the only way to change piece order (movePiece is called from the drop handler alone). The chip is a <span>, not focusable: no tabindex, no role, and there is no keydown handler on it -- the only keydown listener in the whole popup is the document-level Escape handler (popup.ts:527). The on-screen hint states drag as the mechanism (popup.html:510-512, i18n key filenameDragHint), confirming it is the intended and sole affordance. The other filename operations (add via .filename-add-chip button, remove via .filename-chip-remove button, restore default) are keyboard-reachable, so reorder is the one orphaned operation.
- **Failure scenario:** A keyboard-only or switch-access user opens Options -> File name wanting `date_platform_title` instead of the shipped `platform_title_date`. They can Tab to each remove button and each add-chip, so the only route is: remove all three pieces, then re-add them in the desired order -- and that only works because add always appends. If a user wants free text in the middle of the name (literal chips can appear more than once, so removing/re-adding cannot reproduce an arbitrary interleaving without rebuilding the whole list), the target order is unreachable. Screen-reader users get no announcement that the chips are reorderable at all, since the hint paragraph is not associated with the field.
- **Suggested fix:** Make the chip a focusable button-like element (`chip.tabIndex = 0`, `role="button"`, `aria-label` naming the piece and its position) and add a keydown handler that treats Ctrl+ArrowLeft / Ctrl+ArrowRight (or Alt+Arrow) as `this.movePiece(index, index - 1)` / `(index, index + 1)`. movePiece already exists and does the whole job, so this is a handler plus a focus restore to the moved chip after renderFilenameBuilder(). Update the filenameDragHint string in the 7 locales to mention the key combination.
- **Evidence:** const chip = el('span', 'filename-chip');
    chip.draggable = true;
    chip.dataset.pieceType = piece.type;
    chip.dataset.pieceIndex = String(index);
    chip.addEventListener('dragstart', () => {
      this.draggedPieceIndex = index;
    });
    ...
    chip.addEventListener('drop', (event) => {
      event.preventDefault();
      this.movePiece(this.draggedPieceIndex, index);
    });
// popup.html:510  <p class="filename-hint" data-i18n="filenameDragHint">Drag the pieces to reorder them.</p>

### [high] The format menu opens with no ARIA state and no focus move, and leaves the dimmed background controls in the tab order

- **Where:** `src/extension/popup/popup.html`:200
- **Problem:** Four defects on one control. (1) #format-menu-toggle has no aria-expanded and no aria-haspopup; setFormatMenuOpen (popup.ts:433) only writes data-format-menu-open on the body box, so the open/closed state exists purely as a CSS hook. (2) Focus is never moved into the menu, and the menu declares role="menu" with role="menuitemradio" children -- a composite widget that AT users expect to drive with Arrow keys; the only keydown handler in the popup handles Escape (popup.ts:506). (3) The menu is the LAST element of #view-main in DOM order, after .action-bar, yet it paints ABOVE the action bar (position:absolute; bottom:120px, popup.css:802-808), so Tab from the toggle goes to #print-button (visually below the menu) before reaching the first menu item -- a focus order that does not match the visual order. (4) When the menu is open, .view-scroll and .setting-rows only get opacity:0.35 (popup.css:822-825); they stay in the tab order, so Tab from inside the open menu lands on the 35%-opacity Content/Options rows behind it. Additionally the six menuitemradio buttons are not direct children of the role="menu" element -- the plain <div class="format-menu-list"> at popup.html:237 sits between them, breaking menu -> menuitem ownership.
- **Failure scenario:** Screen-reader user wants DOCX instead of Markdown. They Tab to "Change format", press Enter: nothing is announced (no aria-expanded change, focus unmoved), so as far as the AT is concerned the button did nothing. Pressing ArrowDown does nothing either. If they guess to keep Tabbing, they pass through "Print" -- a control that is now visually covered by the menu -- before reaching "Markdown". Once inside, one more Tab past "JSON" lands them on the barely-visible Content row behind the open menu, with no indication they have left the menu.
- **Suggested fix:** In setFormatMenuOpen(open): set `toggle.setAttribute('aria-expanded', String(open))`, add a static `aria-haspopup="true"` in the HTML, and on open focus the row for the current format (revealSelectedFormatRow already finds it) / on close return focus to the toggle. Add ArrowUp/ArrowDown/Home/End handling to handleRouterKeydown when this.formatMenuOpen, moving focus between the .format-row buttons. Move the .format-menu element before .action-bar in the DOM so tab order matches paint order, or apply `inert` to .view-scroll/.setting-rows/.print-button while the menu is open instead of bare opacity. Move role="menu" onto .format-menu-list (or drop the div) so the menuitemradios are owned directly.
- **Evidence:** <button
                  type="button"
                  class="split-toggle"
                  id="format-menu-toggle"
                  data-format-menu-toggle
                  data-i18n-label="changeFormatButton"
                >

// popup.ts:433
  private setFormatMenuOpen(open: boolean): void {
    this.formatMenuOpen = open;
    this.bodyBox()?.setAttribute('data-format-menu-open', String(open));
    if (open) this.revealSelectedFormatRow();
  }

// popup.css:822
.popup-body[data-format-menu-open='true'] .view-scroll,
.popup-body[data-format-menu-open='true'] .setting-rows {
  opacity: 0.35;
}

### [medium] Free-text filename chip has its focus ring removed with no replacement, defeating the popup's own global focus rule

- **Where:** `src/extension/popup/popup.css`:1514
- **Problem:** `.filename-chip-input:focus { outline: none; }` (specificity 0,2,0) overrides the global `:focus-visible { outline: 2px solid var(--color-accent) }` at popup.css:1994 (specificity 0,1,0), whose own comment reads "Keyboard focus must stay visible everywhere in the popup". The input is styled `border: none; background: none` (popup.css:1504-1512) and there is no `.filename-chip:focus-within` rule anywhere (grep for `focus-within` returns zero hits in src/), so focusing it produces no visual change whatsoever — WCAG 2.4.7 failure on the one free-text field in the UI.
- **Failure scenario:** Options → File name, then Tab through the chip row. When focus reaches the literal chip's `<input class="filename-chip-input">` (created in popup.ts:882-907) nothing on screen changes — the caret is the only cue, and it is invisible on an empty chip whose `size` is 4. The user types and cannot tell which chip received the characters; every other chip in the row shows the accent outline, so the field looks skipped.
- **Suggested fix:** Delete the `.filename-chip-input:focus { outline: none }` rule and let the global `:focus-visible` ring apply, or move the indicator to the chip: `.filename-chip:focus-within { box-shadow: 0 0 0 2px var(--color-accent) }` alongside the existing `box-shadow: 0 0 0 1px var(--color-border)` at popup.css:1490.

### [medium] Format menu declares role=menu/menuitemradio but implements no menu keyboard behaviour, and its toggle exposes no expanded state

- **Where:** `src/extension/popup/popup.html`:200
- **Problem:** `.format-menu` is `role="menu"` with six `role="menuitemradio"` buttons (popup.html:235-280), but `setFormatMenuOpen()` (popup.ts:433-437) only flips a `data-format-menu-open` attribute: focus is never moved into the menu, there is no roving tabindex, and Arrow/Home/End are unhandled (the only keydown handler is Escape, popup.ts:506-515). The opener `#format-menu-toggle` (popup.html:200-210) has neither `aria-expanded` nor `aria-haspopup`, so the open/closed state exists only as a CSS chevron rotation. `role="menu"` also puts NVDA/JAWS into focus mode, where arrow keys are the expected navigation — and here they do nothing.
- **Failure scenario:** NVDA user wants JSON instead of Markdown. They Tab to the split toggle: it is announced as just "Change format, button" with no state, and pressing Enter announces nothing (the menu appearing is silent). The screen reader enters focus mode on the menu role, so Down-arrow does nothing. Because `.format-menu` sits after `.action-bar` in the DOM, the next Tab goes to the Print button, not into the menu — the six format choices are two stops further on, behind the button that appears to have done nothing.
- **Suggested fix:** Cheapest correct fix: drop `role="menu"`/`role="menuitemradio"` and rebuild the six rows as a native radio group (`<fieldset>` + `<input type="radio" name="export-format">` + `<label>`, exactly the pattern already used for Text size at popup.html:345-361) — native arrow-key navigation and state announcement for free, no JS. Either way, add `aria-haspopup="true"` to `#format-menu-toggle` and set `aria-expanded` from `setFormatMenuOpen()` (popup.ts:433), and focus the checked row when the menu opens (`revealSelectedFormatRow()` at popup.ts:444 already finds it — call `.focus()` there instead of only `scrollIntoView`).

### [medium] Content behind the open format menu is dimmed to 0.35 opacity but stays focusable and clickable

- **Where:** `src/extension/popup/popup.css`:822
- **Problem:** `.popup-body[data-format-menu-open='true'] .view-scroll, .setting-rows { opacity: 0.35 }` dims the conversation block and both setting rows while the menu floats over them, but nothing removes them from the tab order or blocks pointer events — `setFormatMenuOpen()` (popup.ts:433-437) sets no `inert` and there is no `pointer-events: none`. So a 0.35-opacity control (well under the 4.5:1 text and 3:1 non-text contrast minimums against `--color-surface`) is still an interactive tab stop, and `handleRouterClick()` checks `data-nav` *before* the outside-click close (popup.ts:479-503), so activating it navigates rather than dismissing the menu.
- **Failure scenario:** Open the format menu, then Tab: focus moves to the Print button and then into the dimmed "Content"/"Options" rows underneath the menu, with a focus ring drawn on 35%-opacity text. Press Enter on the dimmed Options row: the popup navigates to the Options view while `data-format-menu-open` is still `"true"`, so returning to main shows the format menu still open over it.
- **Suggested fix:** In `setFormatMenuOpen()`, toggle the native `inert` attribute on `.view-scroll` and `.setting-rows` alongside the existing attribute write — one line, and it removes them from tab order, hit-testing and the accessibility tree at once.

### [medium] Popup document has no lang attribute despite shipping 7 locales

- **Where:** `src/extension/popup/popup.html`:2
- **Problem:** `<html>` carries no `lang` attribute, and nothing adds one at runtime — `applyTheme()` (popup.ts:406-408) is the only code that touches `document.documentElement`, and it sets `data-theme` only. Meanwhile every visible string is swapped to the UI locale by `localizeHtmlPage()` (popup.ts:168) from `_locales/{ca,de,en,es,fr,it,pt}`. WCAG 3.1.1 (Language of Page) failure. The HTML exporter gets this right — `html-exporter.ts:122` emits `<html lang="${getUILanguage()}">` — so the precedent and the helper both already exist.
- **Failure scenario:** A German-locale user opens the popup with NVDA. "Es gibt hier kein Gespräch zum Exportieren" is announced by the default English voice, which mangles it to the point of being unintelligible; the same happens to every Catalan, Spanish, French, Italian and Portuguese string.
- **Suggested fix:** Set it in `initialize()` next to the existing `localizeHtmlPage()` call: `document.documentElement.lang = getUILanguage();` — `getUILanguage` is already imported at popup.ts:20.

### [medium] Exported HTML skips from h1 to h3 and has no heading for any conversation turn

- **Where:** `src/core/exporters/html-exporter.ts`:254
- **Problem:** The only fixed headings the exporter emits are `<h1 class="title">` (line 133), `<h3>Artifacts</h3>` (line 254) with `<h4>` per artifact (line 259), and `<h3>Web Search Results</h3>` (line 303) with `<h4>` per query (line 308). No `<h2>` is ever emitted structurally: body-content headings go through `bodyHeadingLevel()`, which only produces a level 2 when the answer prose actually contains a Markdown/DOM heading (style-tokens.ts:305-312). A conversation of plain-prose answers plus one artifact therefore renders h1 → h3, skipping h2 (WCAG 1.3.1 / axe heading-order). Compounding it, the turn label is `<p class="message-role">` (lines 210, 219), so a 60-turn export contains exactly one heading for the whole document.
- **Failure scenario:** Export a Claude chat where the answers are prose and one reply produced an artifact. The saved file's heading outline is: h1 "My chat" → h3 "Artifacts" → h4 "script.py". A screen-reader user pressing H (next heading) or opening the heading list jumps straight from the document title into the artifact of turn 17 — there is no heading for turn 1, no h2 anywhere, and no way to move between turns at all.
- **Suggested fix:** Two changes, both style-neutral: (1) render the role label as a heading instead of a paragraph — `<h2 class="message-role">` at lines 210 and 219, keeping the existing `.message-role` CSS (it is already styled as a small label, per the R-1 note in style-tokens.ts:263-268, so nothing looks different) — which also gives per-turn heading navigation; (2) demote the section headings so they nest under it: `Artifacts`/`Web Search Results` → `<h3>` under the turn's h2 is then already correct, and the per-item `<h4>` stays. If turning the role into an h2 is unacceptable, at minimum change lines 254 and 303 to `<h2>` so no level is skipped.

### [medium] Horizontally scrollable code blocks in exported HTML are not keyboard-focusable

- **Where:** `src/core/exporters/html-exporter.ts`:704
- **Problem:** `.message-content pre { overflow-x: auto }` (line 704) makes every code block a scroll container, but the `<pre>` elements emitted at lines 351 and 291 carry no `tabindex="0"` and no `role`/label. A scrollable region with no focusable content cannot be scrolled without a mouse or trackpad (WCAG 2.1.1; axe rule `scrollable-region-focusable`). The popup itself already applies the right pattern to its own scrollable `<pre>` — `popup.html:469` uses `<pre class="drift-report-preview" tabindex="0">`.
- **Failure scenario:** Export a ChatGPT answer containing a 160-column line of code (the repo even ships such a fixture: tests/fixtures/dom-snapshots/chatgpt/longcode-160-lines-2026-07.html). Open the saved HTML and navigate by keyboard only: the code block clips at the container width and there is no way to reach the rest of the line — Tab skips the `<pre>` entirely, so arrow keys never scroll it. The truncated code is unreachable.
- **Suggested fix:** Emit `<pre tabindex="0">` at html-exporter.ts:351 (block code) and :291 (artifact code fallback). Adding `role="region"` with an `aria-label` of the language would also give it a name, but `tabindex="0"` alone clears the barrier.

### [medium] The free-text filename input removes its focus outline with no replacement, overriding the global focus-visible rule

- **Where:** `src/extension/popup/popup.css`:1514
- **Problem:** .filename-chip-input:focus { outline: none; } has specificity (0,2,0) and beats the global `:focus-visible { outline: 2px solid var(--color-accent) }` at popup.css:1994 (specificity (0,1,0)), so the rule applies to keyboard focus as well as mouse focus. No substitute indicator is defined: the parent .filename-chip keeps the same `box-shadow: 0 0 0 1px var(--color-border)` and background whether the input inside it is focused or not (popup.css:1483-1495), and there is no .filename-chip:focus-within rule anywhere in the file. This directly contradicts the comment above the global rule ("Keyboard focus must stay visible everywhere in the popup").
- **Failure scenario:** Keyboard user in Options -> File name with a name like `platform_<free text>_date`. They Tab through the chips; when focus reaches the literal chip's text input the ring disappears entirely, so there is no way to tell whether focus is on the input, on the remove button next to it, or lost. Typing is the only way to find out, and typing immediately mutates the filename (the input handler writes piece.text on every keystroke, popup.ts:894).
- **Suggested fix:** Replace the blanket removal with a focus style on the chip: delete the `.filename-chip-input:focus { outline: none }` block and add `.filename-chip:focus-within { box-shadow: 0 0 0 2px var(--color-accent); }`. That keeps the intended look (no double ring inside the chip) while leaving focus visible.
- **Evidence:** .filename-chip-input:focus {
  outline: none;
}

/* popup.css:1993 */
/* Keyboard focus must stay visible everywhere in the popup. */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

### [medium] Export/print failure detail is exposed only through a title tooltip on a non-focusable div, and the error UI state paints nothing

- **Where:** `src/extension/popup/popup.ts`:721
- **Problem:** updateStatus() puts the long form of any status in `indicator.title` (line 732) on <div id="status-indicator">, which has no tabindex and is not focusable, so the tooltip is reachable by mouse hover only -- not by keyboard, and not by touch. Its own doc comment says the badge text must stay "a word or two" and "anything longer belongs in detail", but the export and print failure paths pass the raw error message as `text` (lines 1186-1189 and 1214), where it lands in .status-text, which is `white-space: nowrap` (popup.css:513) inside a fixed 56px header, so it is visually clipped rather than wrapped. Compounding this, `data-ui-state="error"` has no CSS rules at all (grep for data-ui-state='error' in popup.css returns nothing, while detecting/unsupported/noConversation/reload/warning/noSelection all have blocks), so setUiState('error') leaves the ready-looking main view on screen with no error panel -- unlike the warning path, which does render the full reason in the visible #warning-card-detail.
- **Failure scenario:** Keyboard or touch user presses Export on a Claude chat and the content script throws (for example a message-port failure, giving "Could not establish connection. Receiving end does not exist."). The popup still shows the conversation title and an enabled-looking Export button; the only signal is the header pill, whose 10px no-wrap text is truncated, and whose full text lives in a title attribute they cannot reach. A screen-reader user hears only the truncated fragment from the role=status region. They have no way to learn why the export failed or that anything failed at all.
- **Suggested fix:** Route failure detail into a visible region instead of the tooltip: add a `data-ui-state='error'` rule that reveals a state block (reuse the existing .warning-card markup with role=status, or add an #state-error .state-centered block alongside the other four), and change the catch blocks in handleExport/handlePrint to call `updateStatus('error', getMessage('statusExportFailed'), error.message)` so the short label goes in the badge and the full text into the visible panel, matching updateStatus's documented contract.
- **Evidence:**   private updateStatus(
    status: 'active' | 'inactive' | 'warning' | 'error',
    text: string,
    detail?: string
  ): void {
    ...
      indicator.title = detail ?? text;

// popup.ts:1186 (handleExport catch)
      this.updateStatus(
        'error',
        error instanceof Error ? error.message : getMessage('statusExportFailed')
      );
// grep -n "data-ui-state='error'" src/extension/popup/popup.css -> 0 matches

### [medium] popup.html has no lang attribute, so the whole localized UI is announced in the screen reader's default language

- **Where:** `src/extension/popup/popup.html`:2
- **Problem:** The root element is a bare `<html>` with no lang. Every visible string in the popup is replaced at runtime by localizeHtmlPage() (popup.ts:168) from _locales, which ships ca/de/en/es/fr/it/pt, so the rendered text language is whatever chrome.i18n resolves -- but nothing tells AT what that language is. The exported HTML gets this right (html-exporter.ts:122 emits `<html lang="${getUILanguage()}">`), which makes the popup the inconsistent one.
- **Failure scenario:** A Spanish-locale Chrome user with a screen reader whose default voice is English opens the popup. "Exportar Markdown", "Elegir pares", "Nada se envia a ningun servidor" are all read with English phonemes and are largely unintelligible. Setting lang would let the AT switch voices, exactly as it already does for the exported file.
- **Suggested fix:** Set it from the same source the exporter uses. Either add a static `lang="en"` and have initialize() overwrite it (`document.documentElement.lang = getUILanguage()` next to the existing applyTheme() call, which already writes to documentElement), or emit it at build time. getUILanguage is already imported in popup.ts.
- **Evidence:** <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />

// html-exporter.ts:122 does it correctly:
<html lang="${this.escapeHtml(getUILanguage())}">

### [medium] Exported HTML skips h2: artifact and web-search sections are hardcoded h3/h4 under the h1 title

- **Where:** `src/core/exporters/html-exporter.ts`:254
- **Problem:** The exported document emits exactly one h1 (the conversation title, line 133). Message role labels are <p class="message-role"> (lines 211/220), not headings. The Artifacts section (line 254) and Web Search Results section (line 303) are hardcoded <h3>, with per-item <h4> (lines 259, 308). Body-content headings are the only source of an h2 -- buildHeadingLevelMap (style-tokens.ts:305) maps the shallowest source level to DOC_HEADING_LEVEL.title + 1 = 2 -- so when the conversation body contains no markdown headings, the map is empty and the document goes h1 -> h3 -> h4 with h2 unused. grep for `<h2` in html-exporter.ts returns 0 matches, so no code path can fill the gap. (The stale comment on line 344 claims "h2 the role label", which is no longer true.)
- **Failure scenario:** Export a Claude chat where the user asks for a React component and Claude replies with prose plus a code artifact, and no markdown headings anywhere. The resulting HTML is h1 "Build a date picker" -> h3 "Artifacts" -> h4 "DatePicker.tsx". A screen-reader user navigating by heading level (H key / rotor) hears a level jump and cannot tell whether the artifact belongs to the document or to a missing intermediate section; axe-core flags this as a heading-order violation. The same happens for any ChatGPT answer with web search results and no headings.
- **Suggested fix:** Emit the two section headings at h2 rather than h3, and their items at h3 (change lines 254/259 and 303/308). Since buildHeadingLevelMap starts body headings at 2 as well, they then sit at the same level as body sections, which is accurate -- both are top-level sections of the message. Alternatively wrap each message in a <section> and give the role label a real heading, but changing the two literals is the minimal fix. Also drop the stale "h2 the role label" comment on line 344.
- **Evidence:** // line 133
            <h1 class="title">${title}</h1>
// line 254
                            <h3>Artifacts</h3>
// line 259
                                <h4>${this.escapeHtml(artifact.title)}</h4>
// line 303
                            <h3>Web Search Results</h3>
// style-tokens.ts:305 -> distinct.forEach((level, rank) => map.set(level, Math.min(DOC_HEADING_LEVEL.title + 1 + rank, ...)))
// $ grep -c "<h2" src/core/exporters/html-exporter.ts -> 0

### [low] Infinite pulse animation on the status dot with no prefers-reduced-motion handling

- **Where:** `src/extension/popup/popup.css`:496
- **Problem:** `.status-indicator.active .status-dot { animation: pulse 2s ease-in-out infinite }` runs the opacity 1 → 0.5 → 1 keyframes (popup.css:518-526) for as long as the popup is open. `grep -rn prefers-reduced-motion src/` returns zero hits in the whole repo, so the animation ignores an explicit OS-level request to stop motion (WCAG 2.3.3 AAA / 2.2.2 for content that blinks indefinitely).
- **Failure scenario:** A user with vestibular sensitivity or a photosensitivity trigger has "Reduce motion" enabled system-wide. Every time they open the popup on a supported page, the header's status dot pulses continuously with no way to stop it.
- **Suggested fix:** Add at the end of popup.css: `@media (prefers-reduced-motion: reduce) { .status-indicator.active .status-dot { animation: none } }`. It is the only animation in the file, so that single rule covers the whole popup.

### [low] Decorative images in exported HTML get a hardcoded English alt="image"

- **Where:** `src/core/exporters/html-exporter.ts`:363
- **Problem:** `const alt = this.escapeHtml(block.alt || 'image');` turns an intentionally empty alt into the literal string "image". The parser preserves the source page's decision faithfully — html-content-parser.ts:284 does `const alt = img.alt || ''` — so an image the chat page marked decorative (`alt=""`) arrives here with `alt: ''` and is relabelled as content. The fallback is also a raw English literal in an extension that localises everything else through `getMessage()` (which is already imported in this file).
- **Failure scenario:** Export a Gemini answer that includes spacer/avatar/icon `<img alt="">` elements. In the saved file each becomes `<img alt="image">`, so a screen reader announces "graphic, image" once per decorative asset, interrupting the answer text — where the source page correctly announced nothing. In a Spanish-locale export the announcement is English inside a `lang="es"` document.
- **Suggested fix:** Preserve the empty alt so the image is exposed as decorative: `const alt = this.escapeHtml(block.alt ?? '')` and always emit `alt="..."` (an empty `alt` attribute is what marks an image decorative; omitting the attribute is what must be avoided). If a visible placeholder is genuinely wanted for images that have no alt on a platform that never sets one, route it through `getMessage()` rather than a literal.

### [low] No prefers-reduced-motion handling anywhere; the ready-state status dot pulses indefinitely

- **Where:** `src/extension/popup/popup.css`:496
- **Problem:** `grep -rn "prefers-reduced-motion" src/` returns zero matches across the extension and all exporters. The only keyframe animation in the codebase is `pulse` (popup.css:518), applied with `animation: pulse 2s ease-in-out infinite` to .status-indicator.active .status-dot, i.e. it runs for the entire time the popup is open on a supported page. There is no reduce-motion override and no other stop condition.
- **Failure scenario:** A user with vestibular sensitivity or photosensitivity who has set "Reduce motion" at the OS level opens the popup on any chat page. The 6px status dot fades 1 -> 0.5 -> 1 continuously with no way to pause or stop it (WCAG 2.2.2 covers blinking content lasting more than five seconds). The effect is small but it is the one piece of perpetual motion in the UI and honouring the OS preference costs three lines.
- **Suggested fix:** Add at the end of popup.css: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }`. That covers the pulse now and any animation added later, including in the exported document if the same block is added to html-exporter.ts generateCSS().
- **Evidence:** .status-indicator.active .status-dot {
  background: var(--color-header-accent);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% { opacity: 1; }
  50% { opacity: 0.5; }
}

// $ grep -rn "prefers-reduced-motion" src/  ->  (no output)

---

## Working rules for this task

- Treat each finding independently: fix what is real, and if one does not hold up on inspection say
  so in the PR rather than inventing a change. The reviewers were adversarially checked but not
  infallible.
- **Never trade correctness for tidiness.** If a fix would lose content or weaken a guard, stop and
  report instead.
- Every behavioural fix needs a test that FAILS before it and passes after. State that you verified
  this — it will be checked independently.
- Do not restyle or refactor code outside the findings listed here.

## Acceptance gate

Every finding above is either fixed with a proving test, or explicitly explained as not-a-defect.

```bash
pnpm test:run && pnpm lint && pnpm format:check && pnpm typecheck
```
