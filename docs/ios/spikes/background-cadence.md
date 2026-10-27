# Background cadence: how to measure it (O5)

Goal: learn how often iOS really wakes Flint on the owner's iPhone, so the notification promise ("new mail within about N minutes when Flint is closed") rests on data. This is a measurement note. The result goes in the table at the bottom.

iOS decides when a background refresh runs. Flint can only ask (`co.xanom.flint.refresh`, earliest begin 15 minutes) and use the time it is given. Cadence depends on how often the person opens the app, battery, Low Power Mode, and whether the app was force-quit (a force-quit app gets no background launches until it is opened again).

## What Flint records

Every background run adds one row to Settings > Notifications > Background checks: start time, duration, result (completed, failed, expired), conversations with new mail, alerts posted, and an error code. It keeps the newest 30 runs, on this device only. No sender, subject or message text is stored. The page shows the number of system runs, the average gap in minutes between them, the last run and the new mail seen. "Check now" adds a run of kind "check now", which is not counted as a system run.

## Setup

1. Install a build signed with team VTQW687WBQ on the iPhone from Xcode (Release or Debug both work; Debug adds the Xcode debugger, which keeps the app alive, so unplug and launch from the home screen).
2. Add the real account(s), allow notifications, turn on Settings > Notifications > Alerts.
3. Settings > Background App Refresh: on for Flint. Low Power Mode off for the first week.
4. Note the date and time you start in the log below. Do not force-quit Flint during the week.

## Week plan

Use the phone normally. Do not open Flint on purpose to "help" it. Write down each time you open Flint and whether a notification had already arrived before you did.

| Day | Condition to try |
|---|---|
| 1 to 2 | Normal use, charging overnight, Wi-Fi at home |
| 3 | Low Power Mode on all day |
| 4 | Do not open Flint at all for 24 hours (the hardest case) |
| 5 | Force-quit Flint at night, leave it; expect no runs until the next open |
| 6 | Travel day on cellular only |
| 7 | Read the Background checks page and copy the numbers below |

## Numbers to record

From Settings > Notifications > Background checks at the end of the week (the list holds 30 runs, so read it on day 3 and on day 7 if more than 30 runs are expected):

- System runs listed, and the date range they cover
- Average gap in minutes
- Longest gap (compute from the list)
- Runs that ended `expired` or `failed`, with their error codes
- Notifications that arrived late (by the owner's notes): sent time of the mail versus banner time

## Simulated launch (developer check, not cadence)

With the app running from Xcode, pause in the debugger and run:

```
e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"co.xanom.flint.refresh"]
```

A run should appear in the list within 30 seconds. This proves the handler works, not how often iOS calls it. The same path is covered by `BackgroundRunTests` and the Check now UI test.

## Decisions this feeds

- The wording of the "Alerts can arrive late" note in Settings > Notifications.
- Whether the badge and alerts need push (a server) after v1. Flint has no server of its own, so the answer here is only "good enough" or "not good enough".
- Whether the processing task (`co.xanom.flint.processing`) is worth keeping for scheduled sends: record whether any `processing` rows appear.

## Result (fill in)

| Date range | Device and iOS | System runs | Average gap | Longest gap | Failures | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
