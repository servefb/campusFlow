---
name: Campus Flow
colors:
  surface: '#f9f9f8'
  surface-dim: '#dadad9'
  surface-bright: '#f9f9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f3'
  surface-container: '#eeeeed'
  surface-container-high: '#e8e8e7'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#45474c'
  inverse-surface: '#2f3130'
  inverse-on-surface: '#f1f1f0'
  outline: '#75777d'
  outline-variant: '#c5c6cd'
  surface-tint: '#545f73'
  primary: '#091426'
  on-primary: '#ffffff'
  primary-container: '#1e293b'
  on-primary-container: '#8590a6'
  inverse-primary: '#bcc7de'
  secondary: '#ad312b'
  on-secondary: '#ffffff'
  secondary-container: '#fe6c61'
  on-secondary-container: '#6d0006'
  tertiary: '#00190e'
  on-tertiary: '#ffffff'
  tertiary-container: '#00301e'
  on-tertiary-container: '#00a472'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e3fb'
  primary-fixed-dim: '#bcc7de'
  on-primary-fixed: '#111c2d'
  on-primary-fixed-variant: '#3c475a'
  secondary-fixed: '#ffdad6'
  secondary-fixed-dim: '#ffb4ab'
  on-secondary-fixed: '#410002'
  on-secondary-fixed-variant: '#8b1817'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f9f9f8'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display:
    fontFamily: Inter, PingFang SC, system-ui, sans-serif
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter, PingFang SC, system-ui, sans-serif
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter, PingFang SC, system-ui, sans-serif
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter, PingFang SC, system-ui, sans-serif
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter, PingFang SC, system-ui, sans-serif
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: '0'
  body-md:
    fontFamily: Inter, PingFang SC, system-ui, sans-serif
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: '0'
  body-sm:
    fontFamily: Inter, PingFang SC, system-ui, sans-serif
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: '0'
  label-md:
    fontFamily: Inter, PingFang SC, system-ui, sans-serif
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter, PingFang SC, system-ui, sans-serif
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.02em
  code-sm:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter-xs: 4px
  gutter-sm: 8px
  gutter-md: 12px
  gutter-base: 16px
  gutter-lg: 20px
  gutter-xl: 24px
  gutter-2xl: 32px
  gutter-3xl: 48px
  sidebar-width: 64px
  sidebar-width-expanded: 200px
  context-drawer-width: 360px
  max-content-width: 1280px
---

## Brand & Style

This design system embodies the concept of "Campus Flow" (校园脉络) — transforming dense, bureaucratic campus affairs and academic policies into intuitive, traceable, and human-centered pathways for students and faculty.

### Personality & Emotional Response
- **Clear & Reassuring (明晰安心):** Demystifies policy jargon and institutional friction without feeling sterile or intimidating.
- **Thoughtful & Grounded (沉静有度):** Evokes the intellectual calm of modern libraries and high-end editorial tools, avoiding the chaotic visual noise of traditional administrative portals.
- **Dynamic & Collaborative (脉络共生):** Visualizes the multi-agent assistance loop (routing, policy retrieval, material drafting, verification) with tactile precision.

### Design Movement & Aesthetic Direction
- **Structured Editorial Minimalism (结构化编排主义):** Combines generous whitespace, crisp structural rules, delicate 1px borders, and disciplined typography.
- **Anti-Patterns Strictly Avoided:** Heavy black or dark corporate sidebars, sprawling raw enterprise tables, vivid purple/blue gradient mesh, heavy neon highlights, and blurry glassmorphism.

## Colors

The palette grounds the interface in warm daylight tones, anchoring operations with deep academic ink and guiding attention with targeted energetic accents.

### Palette Architecture
- **Primary Ink (`#1E293B`):** Deep indigo slate. Used for high-priority action buttons, primary icons, dominant headings, and structural anchors.
- **Secondary Accent - Coral Red (`#E0564C`):** High-priority indicators, active stepper nodes, dynamic badges, and focal calls to action. Evokes human warmth and active progression without warning anxiety.
- **Tertiary Accent - Meadow Green (`#10B981`):** Verified policies, completed flow checkpoints, and resolved administrative statuses.
- **Alert / Review - Warm Amber (`#D97706`):** In-review statuses, prerequisite warnings, and pending approvals.
- **Background Foundation - Warm White (`#FBFBFA` / `#F8F9FA`):** Soft, non-glare surface evoking archival paper, reducing eye fatigue during multi-step procedures.
- **Surface Elevation (`#FFFFFF`):** High-clarity white card backgrounds against the warm base.
- **Subordinate Text (`#64748B`):** Neutral slate for metadata, policy citations, and secondary descriptions.
- **Borders & Dividers (`#E2E8F0` / `#EEF2F6`):** Crisp 1px hairline delimiters structuring the space.

## Typography

Typography focuses on high-legibility dual-script balance between Latin characters and Simplified Chinese.

### Hierarchical Restraint
- Academic administrative applications demand editorial restraint. Avoid oversized hero titles; headline scales remain capped at `30px` to maintain information density without feeling cramped.
- Maintain a strict 1.5x to 1.6x line-height ratio on body text to ensure seamless reading of lengthy policy clauses and prerequisites.
- Monospace tokens are selectively applied to file versions, student IDs, form codes, and agent execution timestamps.

## Layout & Spacing

The layout is built upon an asymmetric three-pane workspace designed for continuous flow:
1. **Lightweight Global Navigation Rail (`64px` default):** Compact vertical rail hosting core functional domains with subtle coral accents for the active workspace.
2. **Dynamic Flow Canvas (Flex Center, max `840px` for conversational reading / `1280px` for multi-column dashboards):** The central stage for dialogue, timeline progression, and generated forms.
3. **Contextual Evidence Drawer (`360px`):** Right-anchored pane displaying official department clauses, active AI Agent chains, and source documents. Collapses into a floating anchor tab on narrower viewports.

### Rhythm & Responsive Rules
- **Desktop (>= 1200px):** 3-column split view (Rail + Flow Stream + Evidence Inspector).
- **Tablet (768px - 1199px):** Navigation rail compresses to icon-only; Context drawer becomes a slide-over modal overlay.
- **Mobile (< 768px):** Flow canvas takes 100% viewport width; step rail transitions from horizontal timeline to an accordion-style top banner; margins reduce to `16px`.

## Elevation & Depth

Visual hierarchy uses crisp 1px borders paired with ultra-diffused, paper-like shadows.

### Elevation Levels
- **Level 0 (Base Canvas):** `#FBFBFA` background with zero elevation.
- **Level 1 (Card & Step Container):** Background `#FFFFFF`, border `1px solid #E2E8F0`, shadow `0 1px 3px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.02)`.
- **Level 2 (Hover State & Floating Context Cards):** Border `1px solid #CBD5E1`, shadow `0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 4px -1px rgba(15, 23, 42, 0.03)`.
- **Level 3 (Modal Sheets & Floating Prompt Dock):** Border `1px solid #E2E8F0`, shadow `0 12px 28px -4px rgba(15, 23, 42, 0.08), 0 4px 10px -2px rgba(15, 23, 42, 0.04)`.

No heavy drop shadows or colored glow effects are permitted. Depth is felt through surface purity and delicate micro-outlines.

## Shapes

The design system employs a disciplined, soft-cornered geometry (base `6px` to `8px`), evoking clean-cut physical stationery, index cards, and scholarly instruments.

### Radii Application
- **Base Components (Inputs, Small Badges, Checkboxes):** `6px` (`rounded`).
- **Cards, Flow Containers, Context Sheets:** `8px` (`rounded-lg`).
- **Prompt Pills & Filter Badges:** `9999px` (Pill format reserved strictly for question chips and status pills to distinguish interactive metadata from structured cards).

## Components

### 1. Navigation Rail (Lightweight & Compact)
- **Container:** Pale background (`#F8F9FA`), right border `1px solid #E2E8F0`, width `64px` (expandable to `200px`).
- **Items:** 40x40px rounded icon targets with `label-sm` underneath.
- **Active State:** Deep Indigo glyph (`#1E293B`) with a vertical coral bar indicator (`3px` width, `#E0564C`) pinned to the container's left border.

### 2. Pulse Flow Stepper (脉络步骤轨道)
- **Rail Line:** `2px` continuous stroke in `#E2E8F0`.
- **Completed Node:** `20px` circle, background `#10B981`, white checkmark icon (`12px`), trailing line painted in `#10B981`.
- **Active Node (Current Step):** `24px` double-ring node: `#FFFFFF` center with `#E0564C` core dot (`8px`) encircled by a `2px` `#E0564C` ring and an ambient `4px` coral tint aura (`rgba(224, 86, 76, 0.15)`).
- **Upcoming Node:** `16px` ring with `2px` stroke in `#CBD5E1` on white.
- **Step Card Meta:** Attached card displaying role in charge (e.g., "教务处学籍科"), expected handling time, and mandatory attachments.

### 3. Multi-Agent Co-Pilot Badge & Context Strip
- **Agent Stack:** Compact pill cluster indicating contributing agents (e.g., `Router Agent` ➔ `Policy Agent` ➔ `Drafting Agent`).
- **Visuals:** `#F1F5F9` background, `1px solid #E2E8F0`, with `10px` monoline agent avatar icons and real-time pulse dots (coral blinking dot for actively reasoning agent, solid emerald for verified response).
- **Collapsible Reasoning:** Subtle toggle reading "查看脉络推理过程 (3 步)" revealing policy retrieval logic.

### 4. Policy Citation & Evidence Drawer
- **Drawer Header:** Displays official source badge (e.g., "《2024届本科生转专业实施细则》"), file code, issuing office, and effective timestamp.
- **Excerpt Block:** Warm light-yellow/stone tint (`#FDFDF8`), left border `3px solid #E0564C`, `13px` body text highlighting the exact matching sentence.
- **Action Buttons:** "查看原件 PDF" and "引用至申请书" styled with secondary outlines.

### 5. Multi-line Prompt Dock & Question Capsules
- **Dock Shell:** Pinned bottom bar with a subtle top hairline. Background `#FFFFFF` with Level-2 ambient shadow.
- **Question Capsules (Quick Tags):** Pill buttons (`rounded-full`) with light gray surface (`#F1F5F9`), slate text (`#475569`), hovering into subtle coral text with tinted border (`#FCA5A5`).
- **Input Area:** Borderless multi-line textarea within an inner card wrapped by a crisp `1px solid #CBD5E1` border, focusing to a solid `#1E293B` hairline with no heavy glow. Right-aligned inline toolbar for attachment upload and voice/send actions.

### 6. Standard Inputs & Form Controls
- **Buttons:**
  - *Primary:* Solid `#1E293B`, hover `#0F172A`, text `#FFFFFF`, radius `6px`.
  - *Accent Action:* Solid `#E0564C`, hover `#CC473D`, text `#FFFFFF`.
  - *Secondary / Outline:* Background `#FFFFFF`, border `1px solid #CBD5E1`, text `#334155`.
- **Form Fields:** Height `38px`, border `1px solid #E2E8F0`, radius `6px`, background `#FFFFFF`, text `#1E293B`, placeholder `#94A3B8`.