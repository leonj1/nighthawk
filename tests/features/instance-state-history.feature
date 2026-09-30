Feature: Instance boxes represent state changes
  An instance starts unknown before its first health check.
  Gray represents unknown, green represents online, and amber represents offline.
  History is newest first and includes the initial unknown state.
  Each state change adds one box; repeated results do not add boxes.

  Background:
    Given a newly added instance with no completed health checks

  Scenario: An unchecked instance is gray
    Then the latest instance box is gray

  Scenario: An unchecked instance has only its initial state box
    Then the instance has 1 state boxes

  Scenario Outline: The first completed check determines the current color
    When monitoring reports "<result>"
    Then the latest instance box is <color>

    Examples:
      | result  | color |
      | online  | green |
      | offline | amber |

  Scenario Outline: Box count follows state changes instead of check count
    When monitoring reports "<results>"
    Then the instance has <count> state boxes
    And the instance boxes from newest to oldest are "<colors>"

    Examples:
      | results                         | count | colors                     |
      | online                          | 2     | green, gray                |
      | offline                         | 2     | amber, gray                |
      | online, online, online, online  | 2     | green, gray                |
      | offline, offline, offline       | 2     | amber, gray                |
      | online, offline                 | 3     | amber, green, gray         |
      | online, offline, online         | 4     | green, amber, green, gray  |
