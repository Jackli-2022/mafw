# Config Page Beautification Plan

## Current State Analysis

### What exists:
1. **Config.tsx** - Left nav with 6 sections: Gateway, Plugins, Models, Usage, opencode, MAFW
2. **Usage section in Config.tsx** - Full config editing (token limits, budgets, cookies, plugins)
3. **UsageDock.tsx** - Right sidebar showing usage statistics with "配置" button → Config page
4. **UsagePill.tsx** - Titlebar pill showing usage status

### What needs beautification:
The Config page is functional but visually plain. Needs:
- Better card design with subtle shadows
- Improved spacing and typography
- Better color usage and visual hierarchy
- Smoother transitions and hover states
- Better organized Usage section

## Beautification Plan

### Phase 1: CSS Improvements (mafw.css)

#### 1.1 Card Design
- Add subtle box-shadow to `.mafw-config-section`
- Improve border-radius and padding
- Better hover effects with shadow elevation

#### 1.2 Typography
- Better font sizes and weights
- Improved label styling
- Better color contrast

#### 1.3 Spacing
- Consistent padding/margins
- Better section separation
- Improved form field spacing

#### 1.4 Visual Hierarchy
- Better section headers
- Improved status badges
- Clearer call-to-action buttons

### Phase 2: Usage Section Improvements

#### 2.1 Better Organization
- Group related fields visually
- Add section descriptions
- Improve add/remove UX

#### 2.2 Input Styling
- Better focused states
- Improved validation feedback
- Clearer placeholder text

### Phase 3: Responsive Design
- Better mobile layout
- Collapsible sections
- Touch-friendly controls

## Implementation Tasks

1. Update CSS in mafw.css for better visual design
2. Improve Usage section layout and UX
3. Add subtle animations and transitions
4. Test across different screen sizes
