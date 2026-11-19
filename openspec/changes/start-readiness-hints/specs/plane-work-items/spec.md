## ADDED Requirements

### Requirement: Readiness hints before Start
The Start confirmation SHALL list a hint for each of these that holds for the item: it has no description; its description has fewer than 200 characters of text; its description has no checklist item; its description has no code reference (inline code, a code block or a file path) and no link. Hints SHALL NOT disable Start and SHALL NOT need a request to Plane or to a model.

#### Scenario: Empty description
- **WHEN** the user opens the Start confirmation for an item without a description
- **THEN** the confirmation shows the hint that the item has no description, and Confirm stays enabled

#### Scenario: Short description without criteria
- **WHEN** the item's description is the single sentence "Login is slow."
- **THEN** the confirmation shows the hints for a short description, no checklist and no code reference or link

#### Scenario: Ready ticket
- **WHEN** the description is longer than 200 characters, has a checklist item and names the file `src/auth/login.ts`
- **THEN** the confirmation shows no hints
