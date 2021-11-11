# buffer-time
settings:
  - calendar watchlist (NOTE: when excluding a calendar all upcoming Buffer time events for that calendar will be removed)
    - [x] Activities and events
    - [x] *External calendars*
    - [ ] Tasks
    - [ ] Birthdays
    - [ ] Contacts
    - [ ] Reminders
    - [ ] Buffer time
  - preferred transportation type
    - [driving, walking, bicycling, transit]
  - adjust buffer time more optimistically/pesimistically
    - slider (-0.5 -- 0.5) [default: 0]
  - [ ] create Buffer time events after an event

questions:
  - what if location invalid, e.g. number of hotel room
    - ignore all locations farther than 2h
  - what if user changes the buffer event in any way
    - don't update the event
  - how to handle work events that the user attends virtually (via google meet)
    - the user should manually delete the event
  - how are events that the user hasn't created handled
    - only track events the user has responed to with yes/maybe
  - can I choose transit type
    - no
  - what is the timedelta since last event with a location to assume the user is still at the same location
    - 4 hours, it cannot be changed
  - how are deleted Buffer time events handled
    - they do not get recreated until the user manually deletes the buffer\_time\_event\_id from the main event description
