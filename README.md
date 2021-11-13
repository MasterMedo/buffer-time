# buffer-time
The Buffer Time events should only be handled by the application and not by the user.
Trust the application to work properly, set locations of all events in your calendar, so the app can detect where you are at each point in time.

Settings:
  - Calendar watchlist (NOTE: when excluding a calendar all upcoming Buffer time events for that calendar will be removed)
    - [x] Activities and events
    - [x] *External calendars*
    - [ ] Tasks
    - [ ] Birthdays
    - [ ] Contacts
    - [ ] Reminders
    - [ ] Buffer time
  - Preferred transportation type
    - [driving, walking, bicycling, transit]
  - Adjust buffer time more optimistically/pesimistically
    - slider (-0.5 -- 0.5) [default: 0]
  - [ ] Create Buffer time events after an event
  - [ ] Notify 10 min before buffer time event

questions:
- What if location invalid, e.g. number of hotel room?
  - [ ] Use geocoder status to determine if the location is valid. If location is invalid don't create a Buffer time event for it
  - [x] Ignore all locations farther than 6h.
- What if the user updates the Buffer time event?
  - [ ] If the user updates the duration of the event, the application doesn't handle the duration of the event anymore, except if the user clicks on the link in the description of the buffer time event to adjust the duration to a travel time mode suggestion.
  - [ ] TODO (DO WE HANDLE EVENTS BUFFER TIME OR LOCATION BUFFER TIME) suggestion if the user changes the time of the event, and the tied event start time doesn't match the end time of the buffer event,
- How are work events that the user attends virtually (via google meet) handled, if they have the location of the office?
  - A buffer time event will be created and the user should manually delete it.
- How are events that the user hasn't created handled?
  - [ ] Only track events the user has responed to with yes/maybe.
- Can I choose transit type?
  - [ ] Not yet, if there is enough interest it will be implemented.
- What is the timedelta since last event with a location to assume the user is still at the same location?
  - [ ] 4 hours, it cannot be changed.
- How are deleted Buffer time events handled?
  - [ ] They do not get recreated until the user manually deletes the buffer\_time\_event\_id from the main event description.
  - NOTICE: I don't want to store any data in user events that is visible to the user, maybe we can found a workaround to store it somewhere hidden.
- Do you support recurring events?
  - No. When a user has recurring events, Buffer time events that tie to those events aren't recurring. This is because handling recurring events is very complicated if the recurring events change or keep changing, especially with "this and following events" changes.
- How does preferred transport in the description of the Buffer time event work?
  - One of two things happen (based on what we decided to implement):
  - [ ] Upon seeing the preferred transport method has been updated, the application adjusts the duration of the Buffer time event.
  - [ ] Every transport method has a link that sends the event id to our server and the preferred method, the server then edits the Buffer time event with the proper duration for that transport method.
- Can Buffer time events overlap with main events instead of being before/after?
 - No, then there would be no point in creating buffer time events.

Issues:
- [x] Event duration doesn't correspond to the event title (`duration['value'] != duration['text']`).
