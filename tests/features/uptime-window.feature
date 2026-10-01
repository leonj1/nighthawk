Feature: Rolling 30-day uptime
  The same healthy-to-known-check ratio applies to every instance.

  Background:
    Given the uptime clock reads "2026-09-30T12:00:00.000Z"

  Scenario: No completed checks show no uptime number
    Given a platform with no tallied checks
    Then instance uptime reads "No uptime data"
    And platform uptime reads "No uptime data"
    And dashboard uptime reads "No uptime data"

  Scenario: A new instance shows its actual coverage
    Given an instance first checked 3 days ago with 25920 good checks out of 25920
    Then instance uptime reads "100.00%"
    And instance uptime coverage reads "over 3 of 30 days"
    And instance uptime is not provisional

  Scenario: An old instance is capped at the window
    Given an instance first checked 400 days ago with 258000 good checks out of 259200
    Then instance uptime reads "99.53%"
    And instance uptime coverage reads "over 30 of 30 days"

  Scenario: Below target is flagged on the dashboard
    Given an instance first checked 30 days ago with 2500 good checks out of 2600
    Then dashboard uptime reads "96.15%"
    And dashboard uptime is marked below target

  Scenario: Seconds-old data is shown provisionally
    Given an instance first checked 20 seconds ago with 2 good checks out of 2
    Then instance uptime reads "100.00%"
    And instance uptime coverage reads "over 1 of 30 days"
    And instance uptime is provisional

  Scenario: A single failure is visible at two decimal places
    Given an instance first checked 30 days ago with 99999 good checks out of 100000
    Then instance uptime reads "99.99%"

  Scenario: Unknown results are excluded from the denominator
    Given an instance first checked 1 day ago with 7 good checks out of 9 and 4 unknown results
    Then instance uptime reads "77.77%"

  Scenario: Platform availability uses any healthy instance
    Given two instances where one succeeded 3 of 4 and the other succeeded 1 of 4, never both failing
    Then platform uptime reads "100.00%"
    And first instance uptime reads "75.00%"
    And second instance uptime reads "25.00%"
