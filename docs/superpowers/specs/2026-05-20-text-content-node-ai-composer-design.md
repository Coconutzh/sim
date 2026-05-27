# Text Content Node AI Composer Design

Date: 2026-05-20
Status: Draft for user review
Scope: Add an inline AI composer beneath `content/text` nodes on the workflow canvas

## Summary

This design adds a TapNow-style AI composer beneath existing `content/text` nodes so a text card can function as a lightweight AI-assisted writing surface.

The composer is part of the text content node, not a separate node, side panel, or workflow execution step. It lets the user:

- enter and keep a prompt draft on the node
- choose an AI model from the node
- submit the prompt directly to a large language model
- receive generated content back into the same text node
- decide whether the generated content should replace or append to the current text

This iteration is intentionally scoped to `content/text` only. However, the UI and state boundaries should be structured so the same composer shell can later be reused by `image`, `video`, and `audio` content nodes.

## Goals

- Make a text content node feel like a complete creation card, not only a static note
- Show the AI composer when a text node is selected, without changing existing text editing behavior
- Persist the prompt draft and selected model on the node
- Use the current provider infrastructure rather than workflow execution semantics
- Return generated content into the same text node in a controlled way
- Keep the design compatible with later AI-enabled media content nodes

## Non-Goals

- Adding AI composer support to image, video, or audio nodes in this iteration
- Turning text content nodes into executable workflow blocks
- Adding workflow handles or execution-chain connections to content nodes
- Building streaming token-by-token insertion into the text node
- Building a multi-message node chat history UI
- Supporting complex rich text structures beyond the existing text node formatting model
- Implementing the optional `3x` control shown in the inspiration image

## User-Approved Product Decisions

- The AI composer appears beneath the text card and is the same width as the text node
- The AI composer is shown when the text node is selected
- The current text toolbar remains above the node
- The node still uses single-click to select and double-click to enter text editing
- Prompt draft is persisted on the node
- Prompt draft is not cleared after a generation request completes
- Model selection is persisted on the node
- Model picker options include short descriptive hints, not only model names
- Generation is non-streaming in this iteration
- The composer shows loading feedback inside the input area while generating
- Generated output does not auto-overwrite the text node
- After generation, the user chooses whether to replace or append
- If the user switches to another card while generation is running, generation continues
- When the model returns, the result is attached back to the original text node
- The replace-or-append decision can be completed later when the user returns to that text node
- AI output should support lightweight structure mapping into `H1`, `H2`, `H3`, paragraph, and bullet list

## Recommended Approach

Add a reusable inline composer shell to `content/text` nodes and have it call the existing `/api/providers` route directly using the selected model.

This approach is preferred because it:

- matches the product requirement of a node-local creation surface
- avoids coupling content generation to workflow execution semantics
- supports model switching without refactoring the current `wand` API contract
- keeps the first iteration stable by using a non-streaming request/response flow
- creates a clean path for future reuse by other content-node variants

## Architecture

### Node-Level Composition

The text content node becomes a two-part card when selected:

- upper area: existing text content card
- lower area: inline AI composer

When not selected:

- the text content remains visible as today
- the AI composer is hidden

The selection model remains unchanged:

- single click selects the node
- double click on text content enters editing mode
- selection shows both the text toolbar and the AI composer

The AI composer is not rendered for `content/image`, `content/video`, or `content/audio` in this iteration.

### Reusable Shell Boundary

Although only text nodes use the AI composer now, the design should separate:

- a generic `ContentNodeAiComposer` shell
- text-node-specific result application logic

The generic shell is responsible for:

- prompt input
- model selection
- submit action
- loading state
- inline error state
- completion state that exposes a generated result for the host node to apply

The text node is responsible for:

- mapping generated content into supported text HTML
- offering `Replace` and `Append` actions
- writing content back into `contentHtml`

This boundary keeps the composer extensible for future media-node AI flows.

## Data Model

### Persisted Node Fields

Persist these values on `content/text` nodes:

- `aiPrompt`
- `aiModel`

Recommended defaults:

- `aiPrompt`: empty string
- `aiModel`: a fast Gemini model already supported by the repository, such as `gemini-3.1-flash-lite-preview`

These fields should live in the existing `content` block subblock storage rather than a separate store.

### Ephemeral UI State

Do not persist generation-in-progress state or unresolved generated output into the workflow document by default.

Keep transient state in workflow-local UI state keyed by `blockId`, for example:

- `isGenerating`
- `generationError`
- `pendingGeneratedText`
- `pendingResolution`

Where:

- `pendingGeneratedText` is the raw generated result waiting for `Replace` or `Append`
- `pendingResolution` indicates that the node has a completed result that the user has not applied yet

This state must survive node deselection during the current page session. It does not need to survive a full page refresh.

## Interaction Design

### Selected vs Unselected

When unselected:

- show only the text content card
- do not show the AI composer

When selected:

- show the text toolbar above the node
- show the AI composer below the node
- keep widths visually aligned so the two parts read as one creation card

### Text Editing Compatibility

Text editing behavior remains unchanged:

- single click selects only
- double click enters text editing
- blur exits editing

The AI composer must not break:

- text selection
- caret placement
- node dragging
- width and height resizing
- action bar interactions

Pointer handling inside the composer should prevent accidental node deselection, drag start, or editor blur where appropriate.

### Prompt Input

The prompt input is a multi-line input area in a dark rounded composer surface.

Behavior:

- prompt text is stored on the node
- prompt text remains after send
- prompt text remains after deselection
- prompt text remains after refresh
- `Enter` submits
- `Shift+Enter` inserts a newline

### Model Picker

The model picker appears at the lower-left area of the composer.

Behavior:

- shows the currently selected model
- opens a picker with model names plus short usage descriptions
- persists the selected model on the node

The first iteration can use a curated model list rather than a dynamic server-fetched catalog, as long as the chosen models are valid in the existing provider model registry.

### Submit and Loading

The submit button appears at the lower-right area of the composer.

On submit:

1. validate prompt is non-empty
2. mark this node as generating
3. disable repeat submission
4. show loading state and inline animation inside the composer
5. keep the prompt visible and unchanged

This iteration does not stream partial text into the text node.

### Switching Away While Loading

Generation must not be tied to the node staying selected.

If the user selects another card while a request is running:

- the original request continues
- the original text node may hide its composer because it is no longer selected
- generation state remains attached to the original node in local UI state
- when the model returns, the result is attached to the original node, not the newly selected node

This is a key behavioral rule for the feature.

### Completion and Apply Choice

When generation completes:

- do not immediately modify `contentHtml`
- store the generated result as pending on the original text node
- show a lightweight node-local choice for:
  - `Replace`
  - `Append`

If the node is still selected when the result arrives, the choice can appear immediately in the composer area.

If the node is not selected when the result arrives:

- keep the generated result pending
- when the user reselects the original node, show the `Replace` and `Append` choice

This avoids surprise text replacement while still preserving the generated result on the correct node.

## Provider Request Flow

### Request Path

The text node AI composer calls the existing `/api/providers` route directly.

It should send:

- `workspaceId`
- `provider`
- `model`
- `systemPrompt`
- `messages`

Recommended message shape:

```ts
messages: [{ role: 'user', content: prompt }]
```

The provider should be derived from the model using the existing model/provider mapping in the codebase rather than hardcoded by the user.

### System Prompt

Use a fixed system prompt oriented around text-node output, for example:

- generate user-facing writing content
- avoid code fences
- avoid meta commentary about the model unless explicitly asked
- prefer headings, paragraphs, and bullet lists when useful
- return content suitable for direct insertion into a whiteboard-style text node

Implementation should use one fixed system prompt that enforces these behaviors consistently for all text-node AI generations in this iteration.

### Model Catalog

Start with a curated set of known-supported models, likely centered on Gemini models already present in the repository.

Example direction:

- `gemini-3.1-pro-preview`
- `gemini-3.1-flash-lite-preview`
- `gemini-2.5-pro`
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`

Each option should have a short label or description such as:

- `Fast draft`
- `Balanced`
- `Best quality`

## Output Mapping

### Supported Formatting

The AI result should be mapped into the text node's supported formatting set:

- `H1`
- `H2`
- `H3`
- paragraph
- unordered bullet list

### Mapping Strategy

Do not trust arbitrary model HTML directly.

Instead:

1. treat the provider response as model-authored text
2. normalize common heading and list structures
3. transform them into the simplified HTML model already used by `content/text`
4. downgrade unsupported structures into paragraphs

This keeps the text editor stable and avoids introducing malformed rich text.

### Replace

If the user chooses `Replace`:

- replace the current `contentHtml` with the normalized generated content

### Append

If the user chooses `Append`:

- keep the current `contentHtml`
- append normalized generated content with sensible spacing or paragraph boundaries

Append should not jam two unrelated HTML fragments together without cleanup.

## Error Handling

### Validation Errors

- empty prompt: show inline validation, do not send
- missing model: show inline validation, do not send

### Request Errors

If provider execution fails:

- keep the prompt draft unchanged
- keep the text node content unchanged
- clear loading state
- show an inline error inside the composer
- allow retry

### Permission or Availability Errors

If the selected model is not allowed or not available:

- show a clear inline error
- do not remove the current prompt or text content
- let the user choose a different model and retry

### Empty or Invalid Responses

If the provider returns empty content or unusable output:

- do not change `contentHtml`
- show a lightweight inline error or warning
- keep the request history implicit rather than logging visible chat bubbles

## Testing Scope

### Data and Defaults

- `content/text` nodes support persisted `aiPrompt`
- `content/text` nodes support persisted `aiModel`
- default AI model is applied on new text-node creation

### Visibility and Selection

- single-click selection shows the AI composer
- deselection hides the AI composer
- double-click text editing still works
- composer interactions do not break node drag, text editing, or resize behavior

### Prompt Behavior

- prompt persists after deselection
- prompt persists after refresh
- prompt is not cleared after submit
- `Enter` submits
- `Shift+Enter` adds a newline

### Model Picker

- current model is visible in the composer
- picker shows labels and short descriptions
- selected model persists after refresh

### Generation Flow

- submit starts loading state
- loading animation appears in the composer
- repeated submit is blocked while generating
- request is sent to `/api/providers`

### Switching Cards

- generation continues if the user selects another card
- the generated result returns to the original text node
- the original text node can later surface `Replace` and `Append`

### Apply Choice

- `Replace` overwrites the text node with normalized generated content
- `Append` appends normalized generated content with clean spacing
- neither action corrupts the existing simplified HTML structure

### Failure Cases

- empty prompt is blocked
- provider error preserves prompt and content
- forbidden model error is surfaced inline
- empty generation result does not overwrite content

## Risks and Mitigations

### Result Ownership Across Selection Changes

Risk:

- it is easy to accidentally bind generation result UI to the currently selected node rather than the original request source

Mitigation:

- all request lifecycle state must be keyed by originating `blockId`
- apply actions must target the originating `blockId`

### Arbitrary Model Output Shape

Risk:

- provider output may include markdown quirks, unsupported formatting, or meta commentary

Mitigation:

- constrain the system prompt
- normalize output before converting into node HTML
- degrade unsupported structures into paragraphs

### Canvas Interaction Conflicts

Risk:

- adding another interactive surface under the node may interfere with selection, drag, and editor focus rules

Mitigation:

- isolate composer pointer handling carefully
- keep text editing and AI generation interactions separate
- verify resize and action-bar behavior after integration

### Future Media-Node Reuse

Risk:

- if the composer is implemented directly inside `TextContentCard`, future image/video/audio reuse becomes expensive

Mitigation:

- extract a reusable composer shell and keep result application logic host-specific

## Implementation Boundary

This design includes:

- inline AI composer for `content/text`
- persisted prompt and model selection
- direct provider request path
- non-streaming generation
- pending result with explicit `Replace` and `Append`
- selection-independent request lifecycle

This design does not include:

- AI composer for image, video, or audio nodes
- workflow execution integration
- handles or connection semantics
- streaming insertion
- chat transcript UI
- advanced document structures

## Acceptance Criteria

- A text content node becomes a complete creation card when selected
- The AI composer appears beneath the text node and matches the node width
- Prompt and model choice persist on the node
- Generation uses the selected model through the current provider API
- Loading state is visible without clearing prompt text
- Switching to another card does not cancel or misroute the original generation
- Generated results return to the original node and wait for `Replace` or `Append`
- Applying generated text keeps content within the supported simplified formatting model
- Existing text node editing, dragging, resizing, and toolbar behavior continue to work
- The architecture leaves a clean path for future AI composers on image, video, and audio content nodes
