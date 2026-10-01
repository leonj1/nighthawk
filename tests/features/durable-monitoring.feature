@sqlite
Feature: Durable monitoring history
  Platforms, instances, checks and state changes survive application restarts.
  Repeated results advance check times without creating additional state boxes.

  Background:
    Given a platform and instance saved in SQLite

  Scenario: A new instance becomes healthy and survives a restart
    Then the persisted instance boxes are "gray"
    And the persisted platform boxes are "gray"
    When a persisted health check reports "online"
    Then the persisted instance boxes are "green, gray"
    And the persisted platform boxes are "green, gray"
    When the database connection is closed and reopened
    Then all saved entities, checks and transitions are unchanged
    And the persisted timestamps render relative labels and full timestamp tooltips
    And the persisted instance boxes are "green, gray"
    And the persisted platform boxes are "green, gray"

  Scenario: Repeated successes keep the original transition timestamp
    When a persisted health check reports "online"
    And three more successful checks complete
    Then the latest check advances without moving the healthy transition time
    And the persisted instance boxes are "green, gray"
    And the persisted platform boxes are "green, gray"
    When the database connection is closed and reopened
    Then all saved entities, checks and transitions are unchanged
    And the persisted timestamps render relative labels and full timestamp tooltips

  Scenario: An outage and recovery survive a restart
    When a persisted health check reports "online"
    And a persisted health check reports "offline"
    Then the persisted instance boxes are "amber, green, gray"
    And the persisted platform boxes are "red, green, gray"
    When a persisted health check reports "online"
    And the database connection is closed and reopened
    Then all saved entities, checks and transitions are unchanged
    And the persisted timestamps render relative labels and full timestamp tooltips
    And the persisted instance boxes are "green, amber, green, gray"
    And the persisted platform boxes are "green, red, green, gray"

  Scenario: A failed first check is preserved without extra boxes on repeated failures
    When a persisted health check reports "offline"
    And a persisted health check reports "offline"
    And the database connection is closed and reopened
    Then all saved entities, checks and transitions are unchanged
    And the persisted timestamps render relative labels and full timestamp tooltips
    And the persisted instance boxes are "amber, gray"
    And the persisted platform boxes are "red, gray"
