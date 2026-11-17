## ADDED Requirements

### Requirement: Collapse a long description
In the item detail, a description longer than about 500 characters or 10 lines SHALL first show collapsed: its first whole blocks within those limits, followed by a control that shows the whole description. When the first block alone exceeds the limits, the collapsed view SHALL show its start, cut at a word and ending with "…". The expanded description SHALL offer a control that collapses it again. A shorter description SHALL show in full, without the control. Each item SHALL open collapsed.

#### Scenario: Long description
- **WHEN** the user opens an item whose description has many paragraphs
- **THEN** the detail shows its first paragraphs and "Show more"; pressing it shows the whole description and "Show less"; pressing that collapses it again

#### Scenario: Short description
- **WHEN** the user opens an item whose description is within the limits
- **THEN** the whole description shows and there is no "Show more"

#### Scenario: Another item opens collapsed
- **WHEN** the user expands an item's description, goes back to the list and opens another item with a long description
- **THEN** that description shows collapsed
