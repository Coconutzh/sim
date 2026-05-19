# TapNow Content Nodes Design

Date: 2026-05-19
Status: Draft for user review
Scope: Canvas-only content nodes for `text` and `image`

## Summary

This design adds TapNow-style content nodes to the existing workflow canvas without attaching execution semantics. The first iteration introduces a unified `content` node model with two variants:

- `text`
- `image`

These nodes live on the same canvas as workflow nodes but do not participate in workflow execution. They are intended to behave like whiteboard content cards rather than agent configuration blocks.

This iteration prioritizes:

- Fast creation from the existing canvas-first entry points
- Inline editing for text
- Inline upload and preview for images
- Compatibility with the existing workflow store, persistence, undo/redo, collaboration, copy/paste, and selection systems

This iteration explicitly does not include:

- Execution semantics for content nodes
- Connections between content nodes and workflow nodes
- Content-node-only edges
- Video or audio nodes

## Goals

- Add a unified content node model that can later support `video` and `audio`
- Let users create `text` and `image` nodes from the current content-node entry points
- Make text nodes feel like whiteboard text cards, not parameter forms
- Make image nodes feel like upload-and-display cards, not prompt inputs
- Keep all content nodes inside the current `blocks + edges` persistence model
- Avoid broad refactors to execution, realtime, autolayout, or workflow persistence

## Non-Goals

- Converting content nodes into executable workflow blocks
- Replacing the full workflow block system with a separate whiteboard data model
- Building a full document editor
- Supporting arbitrary freeform resizing handles for all node types
- Solving content-node linking semantics in this iteration

## User-Approved Product Decisions

- Content nodes are pure canvas content in this iteration
- Content nodes do not connect to workflow nodes
- It is acceptable for content nodes to have no edges in this iteration
- Text style options are limited to `H1`, `H2`, `H3`, and `paragraph`
- Clicking a text node only selects it and shows its toolbar
- Double-clicking a text node enters edit mode
- Image nodes support a single uploaded image
- Image cards use a fixed card size
- Text cards are resizable by width only in this iteration
- Text height grows with content
- Font size does not scale when the text card width changes

## Recommended Approach

Use a unified `content` block model with `variant = text | image`, rendered by a dedicated canvas node component rather than by the main executable workflow block renderer.

This approach is preferred because it:

- Keeps the model extensible for `video` and `audio`
- Avoids re-binding content-node creation to executable block semantics
- Reuses existing store and collaboration infrastructure
- Limits the blast radius compared with introducing a second independent canvas model

## Architecture

### Data Model

Content nodes remain stored in the existing workflow `blocks` map. They are represented as non-executable blocks with a shared base type and variant-specific content payload.

Recommended shape:

```ts
type ContentVariant = 'text' | 'image'

interface ContentBlockData {
  variant: ContentVariant
  title?: string
}

interface TextContentPayload {
  html: string
  blockStyle: 'paragraph' | 'h1' | 'h2' | 'h3'
  backgroundColor: string
  fontSize: 'sm' | 'md' | 'lg'
  width: number
}

interface ImageContentPayload {
  file: {
    name: string
    path: string
    key?: string
    size: number
    type: string
  } | null
}
```

Implementation detail:

- The base block still participates in workflow persistence as a normal block entry
- The block is marked with content-specific metadata in `block.data`
- Variant payload is stored in subblocks or an equivalent store-backed content shape that remains compatible with the current workflow state update path

### Execution Semantics

Content nodes are non-executable.

- They do not run
- They do not contribute outputs to the workflow graph
- They do not appear as runnable blocks in workflow execution interactions
- They do not expose workflow connection handles in this iteration

### Rendering

Add a dedicated React Flow node type for content nodes:

- `contentBlock`

This renderer is separate from:

- `workflowBlock`
- `noteBlock`
- `subflowNode`

`contentBlock` will delegate by variant:

- `TextContentCard`
- `ImageContentCard`

This keeps executable workflow UI concerns out of content-node rendering.

## Canvas Entry Points

The existing content-node-first entry points remain the creation surface:

- `canvas-menu.tsx`
- `command-list.tsx`
- `workflow.tsx`

Their responsibility changes from:

- mapping product-facing content nodes to executable block types

to:

- mapping product-facing content nodes to a unified `content` block with a `variant`

Creation mapping:

- `New Text` -> `content`, `variant: text`
- `New Image` -> `content`, `variant: image`

Future-safe mapping:

- `New Video` -> `content`, `variant: video`
- `New Audio` -> `content`, `variant: audio`

## Preset Layer

Update the current content preset abstraction to represent product-facing content variants rather than executable block mappings.

The preset layer should define:

- `id`
- `label`
- `description`
- `icon`
- `variant`
- `default values`
- `availability`

This layer becomes the catalog for whiteboard content nodes.

## Interaction Design

### Text Node

#### Selection and Edit Flow

- Single click:
  - selects the node
  - shows a floating toolbar
  - does not enter edit mode
- Double click:
  - enters edit mode
  - places the caret in the text content area
  - keeps the toolbar visible
- Blur:
  - exits edit mode
  - keeps node selection until focus moves elsewhere on the canvas

#### Toolbar

Text toolbar actions in this iteration:

- Background color
- Font size
- Block format: `H1`, `H2`, `H3`, `paragraph`
- Bold
- Italic
- Bullet list
- Copy node

#### Content Editing Model

Use a lightweight editing model rather than a full editor framework in this iteration.

Recommended implementation:

- `contentEditable` editing surface
- controlled formatting actions from the toolbar
- content persisted as simplified HTML

Rationale:

- sufficient for the approved scope
- lower integration cost with the existing node system
- easier to keep stable inside a draggable and selectable canvas

#### Text Card Resizing

This iteration supports width-only resizing.

- users can drag a resize affordance on the card edge
- width changes are persisted
- height grows with content
- font size remains controlled only by the toolbar
- width changes must not implicitly scale typography

The resizing model should avoid introducing arbitrary 2D freeform scaling behavior.

### Image Node

#### Empty State

New image nodes render an empty upload state with:

- a clear upload call-to-action
- a short hint that one image can be uploaded

#### Upload and Replace Flow

- single click selects the node
- the node shows a visible upload or replace action
- selecting a local file uploads it through the existing workspace file upload path
- after success, the node immediately switches to preview mode
- uploading another image replaces the current one

#### Display Rules

- single image only
- fixed card size
- image displayed proportionally within the card
- preserve the main image without stretching
- prefer full-image visibility over aggressive cropping in this iteration

## Connections

### This Iteration

- content nodes do not connect to workflow nodes
- content nodes do not render workflow handles
- content nodes do not create executable edges
- content-node-to-content-node edges are out of scope

### Future Compatibility

The model should avoid assumptions that would block later support for:

- visual-only content edges
- grouped content layouts
- richer whiteboard relationships

However, no edge semantics are introduced now.

## Component Breakdown

### New or Updated Components

- `ContentBlock`
  - shared outer shell for content nodes
  - selection state
  - edit-mode transitions
  - shared node actions such as copy
- `TextContentCard`
  - render text content
  - manage edit mode
  - render text toolbar
  - manage width-only resize behavior
- `ImageContentCard`
  - render empty state
  - render uploaded image preview
  - expose upload and replace actions

### Reused Infrastructure

- existing workflow store and persistence
- existing content-node creation flow
- existing workspace file upload path
- existing copy/paste and undo/redo behavior where compatible
- existing collaborative workflow update path

### Deliberately Not Reused

- existing executable workflow block inline-editor surface
- existing prompt-style image generator block semantics
- existing agent-message-based text mapping

## Store and Persistence Flow

### Create

1. Canvas entry point dispatches content-node creation intent
2. `workflow.tsx` creates a `content` block with the selected variant
3. Default payload is written into the workflow-backed node state
4. The new node is selected

### Edit Text

1. User double-clicks a text node
2. Node enters edit mode
3. Editing actions update local UI state
4. Changes sync back into workflow-backed content state
5. Collaboration and persistence observe the same workflow update path

### Upload Image

1. User triggers upload from image node
2. Existing workspace file upload flow handles the file
3. Success returns a file reference
4. File reference is written into the node payload
5. Node re-renders into preview mode

## Sizing and Layout

### Text Nodes

- deterministic default width on creation
- user-adjustable width afterward
- content-driven height
- no font scaling tied to width changes

### Image Nodes

- deterministic fixed card width and height
- image rendered inside fixed display area

### Layout Stability

The implementation should preserve deterministic node dimensions as much as possible to avoid:

- canvas jitter
- hydration mismatch behavior
- collaboration drift from unstable measured sizing

## Error Handling

### Text Nodes

- toolbar actions should degrade gracefully if a formatting command cannot be applied
- plain text must not be lost during editing failures

### Image Nodes

- upload failure keeps the node in empty or replace-ready state
- node shows a short inline error message
- invalid file type shows a clear image-only validation error
- missing or broken file reference renders a fallback state with replace action

## Testing Scope

### Creation

- `New Text` creates `content` with `variant: text`
- `New Image` creates `content` with `variant: image`

### Text Node Behavior

- single click selects the node and shows toolbar
- double click enters edit mode
- `H1/H2/H3/paragraph` persists correctly
- bold, italic, and bullet list persist correctly
- background color persists correctly
- font size persists correctly
- width-only resizing persists correctly
- copy node action duplicates the node content

### Image Node Behavior

- empty state renders on creation
- single image upload succeeds
- preview appears after upload
- replace flow updates the current image
- non-image files are rejected

### Canvas Compatibility

- content nodes do not expose workflow connection handles
- content nodes do not run
- content nodes coexist with workflow nodes on the same canvas without breaking existing workflow behavior

## Risks and Mitigations

### Lightweight Rich Text Complexity

Risk:

- `contentEditable` can be fragile around selection state, toolbar interactions, and React re-renders

Mitigation:

- keep the supported formatting set intentionally small
- store simplified HTML rather than a broad arbitrary document model
- isolate editor behavior inside `TextContentCard`

### Store Shape Drift

Risk:

- mixing variant-specific content data into current workflow block state may get messy if shape boundaries are unclear

Mitigation:

- define one shared `content` block contract up front
- keep variant payload fields explicit and well-scoped

### Canvas Interaction Conflicts

Risk:

- text editing, dragging, selection, and resizing can conflict with React Flow interactions

Mitigation:

- clearly separate click, double-click, edit, and drag regions
- stop propagation only where necessary
- preserve existing selection and drag conventions

## Implementation Boundary

This design is scoped to:

- content node model unification
- `text` and `image` variants
- text toolbar and lightweight editing
- single-image upload and preview

This design is not scoped to:

- `video` or `audio` implementation
- content-node edges
- content node execution
- advanced content layout/grouping

## Acceptance Criteria

- Users can create text and image content nodes from the existing content-node-first canvas entry points
- Text nodes behave like whiteboard cards with selection-first, double-click-to-edit interaction
- Text nodes support the approved toolbar actions
- Text nodes support width-only resizing with stable typography
- Image nodes support single-image upload, preview, and replacement
- Content nodes do not participate in workflow execution
- Content nodes do not connect to workflow nodes
- The solution stays compatible with the current workflow persistence and collaboration model
