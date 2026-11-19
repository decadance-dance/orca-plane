## ADDED Requirements

### Requirement: Readiness hints before Start
The Start confirmation SHALL show readiness hints. An item without a description SHALL get exactly one hint, that it has no description. Otherwise it SHALL get one hint for each of these that holds: the description has fewer than 200 characters of text; it has no checklist item; it has no code reference (inline code, a code block or a file path) and no link. Hints SHALL NOT disable Start and SHALL NOT need a request to Plane or to a model.

#### Scenario: Empty description
- **WHEN** the user opens the Start confirmation for an item without a description
- **THEN** the confirmation shows exactly one hint, that the item has no description, and Confirm stays enabled

#### Scenario: Short description without criteria
- **WHEN** the item's description is the single sentence "Login is slow."
- **THEN** the confirmation shows exactly three hints: a short description, no checklist, and no code reference or link

#### Scenario: Ready ticket
- **WHEN** the description is longer than 200 characters, has a checklist item and names the file `src/auth/login.ts`
- **THEN** the confirmation shows no hints
