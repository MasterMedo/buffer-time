# Travel Time Events

## Short description
Travel Time Events is a Google Calendar Add-on application that creates travelling events between two calendar events that have a location.
It calculates travel time from the origin location to the destination location by utilising the Google Maps API and creates a travel event in the "Travel time" calendar.

## Detailed description
Travel Time Events creates a user calendar by the name "Travel time".
On every calendar change (edit or create event), the application gets all
events from all of the user's calendars from yesterday to two weeks in the
future. The events are ordered and a timeline of location changes is
constructed. Between every location change, a Travel Time event is created
in the Travel Time Calendar. The Travel Time event duration is calculated
by using the Google Maps API to calculate the commute/travel time between
two locations using the preferred means of transport.

Google Maps executed query results are saved in the user cache to reduce
the number of calls to the API. Travel Time events are tied to real events
in the user's calendars. That allows the user to change the original event,
and Travel Time events are going to be updated automatically.

# How does it work?
The user creates two events less than 4 hours apart with different locations.
On every calendar update, the application calculates the duration of the trip using the Google Maps API and creates Travel Time events in the Travel Time Calendar.

# Privacy policy
User data is not shared. The application has no external dependencies, and
does not use any external APIs. The only APIs used by the application are
Google Cache service, Maps API and Calendar API.

# Pricing
The application is free.

# OAuth Scopes
"https://www.googleapis.com/auth/calendar"
Explanation of the requirements of the application:
- get all user's calendars
- get all calendar events
- create "Travel time" calendar
- create events in "Travel time" calendar
- edit events in "Travel time" calendar
- delete events in "Travel time" calendar

# TODO Settings
  - Calendar watchlist (NOTE: when excluding a calendar all upcoming Travel Time events for that calendar will be removed)
    - [x] Activities and events
    - [x] *External calendars*
    - [ ] Tasks
    - [ ] Birthdays
    - [ ] Contacts
    - [ ] Reminders
    - [ ] Travel Time
  - Preferred transportation type
    - [driving, walking, bicycling, transit]
  - Adjust Travel Time more optimistically/pesimistically
    - slider (-0.5 -- 0.5) [default: 0]
  - [ ] Create Travel Time events after an event
  - [ ] Notify 10 min before Travel Time event

# Questions
- What if location invalid, e.g. number of hotel room?
  - [x] ~Use geocoder status to determine if the location is valid. If location is invalid don't create a Travel Time event for it~ The `duration` will be `None` for the distance matrix call if the location is invalid.
  - [x] Ignore all locations farther than 6h.
- What if the user updates the Travel Time event?
  - [ ] If the user updates the duration of the event, the application doesn't handle the duration of the event anymore, except if the user clicks on the link in the description of the Travel Time event to adjust the duration to a travel time mode suggestion.
  - [ ] TODO (DO WE HANDLE EVENTS Travel Time OR LOCATION Travel Time) suggestion if the user changes the time of the event, and the tied event start time doesn't match the end time of the Travel event,
- How are work events that the user attends virtually (via google meet) handled, if they have the location of the office?
  - A Travel Time event will be created and the user should manually delete it.
- How are events that the user hasn't created handled?
  - [x] Only track events the user has responed to with yes/maybe (tentative, accepted).
- Can I choose transit type?
  - Not yet, if there is enough interest it will be implemented.
- What is the timedelta since last event with a location to assume the user is still at the same location?
  - [x] 4 hours, it cannot be changed.
- How are deleted Travel Time events handled?
  - [ ] They do not get recreated until the user manually deletes the Travel\_time\_event\_id from the main event description.
  - NOTICE: I don't want to store any data in user events that is visible to the user, maybe we can found a workaround to store it somewhere hidden.
  - we can have temporary storage which would store the event id that has the corresponding deleted Travel Time event, and we can delete that entry once the datetime of NOW passes the starting point of that event. If the user moves the event from history to the future we can again create a Travel Time event.
- Do you support recurring events?
  - No. When a user has recurring events, Travel Time events that tie to those events aren't recurring. This is because handling recurring events is very complicated if the recurring events change or keep changing, especially with "this and following events" changes.
- How does preferred transport in the description of the Travel Time event work?
  - One of two things happen (based on what we decided to implement):
  - [ ] Upon seeing the preferred transport method has been updated, the application adjusts the duration of the Travel Time event.
  - [ ] Every transport method has a link that sends the event id to our server and the preferred method, the server then edits the Travel Time event with the proper duration for that transport method.
- Can Travel Time events overlap with main events instead of being before/after?
  - No, then there would be no point in creating Travel Time events.
- Does Travel Time collect my data?
  - No. We don't collect anything, the program runs in the user's browser and doesn't communicate with any external servers.
- Does my location get stored?
  - We intend to store user locations somewhere on the user's Google drive. This will help us reduce the cost of the Google Maps api and reduce the cost of our application.
- Does the application work when I edit my calendar on mobile?
  - No, the application is a Google Calendar Add-on which currently only supports the web version of the calendar. We hope they will soon extend support to mobile platforms.

Proposition of a solution on editing Travel Time events and other people not seeing your Travel Time calendar:
Let's have a "mirror" function, that would copy the Travel Time event to his main calendar (or work calendar), and the Travel Time application will delete and recreate that event whenever the Travel Time event is changed, and the user gets the extra benefit of being able to edit the mirrored events in his calendar for extra control like moving it 10 minutes before, increasing duration etc.

# Food for thought / ideas
- event.setTag("Travel Time", Travel_time_event_id)
- loom video showing the functionality
- ScriptCache instead of UserCache
- settings through homepage
- onOpen replicate create event make location editable and prominent
- check if user changed Travel Time event
- Instead of calling distance matrix for every event, all events should be scanned and only one call made for the distance matrix.
- provide on prem solution for free for power users to run their own python script (cron job script, create your own API key and have 200$ monthly for free on distance API).

google-site-verification: google6ef22c01e75b10c5.html
