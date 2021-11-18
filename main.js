const BUFFER_TIME_CALENDAR = "Buffer time";
const EVENT_DESCRIPTION_ID_PREFIX = "Tied to event: ";
const PREFERRED_TRANSPORT = "driving";
const TRANSPORTS = ["driving", "walking", "bicycling", "transit"];
const EMOJI = { driving: "🚗", walking: "🚶", bicycling: "🚴", transit: "🚆" };
// Calendars that are buffer time events are created for.
const CALENDAR_WATCH_LIST = [
  "Events and activities",
  "Family",
  "mislav.vuletic@memgraph.io",
];
// Amount of time since last having a location to be considered the user
// went to the BASE_LOCATION instead of being at the last event location
const TIME_DELTA = 4 * 60 * 60; // 4 hours
// Home address, the address where the user spends their nights.
const BASE_LOCATION = "Radmanovačka ul. 6f, 10000, Zagreb";
const MAX_BUFFER_TIME_EVENT_DURATION = 6; // 6 hours

function main() {
  const service = authenticate_and_get_service();
  const calendars = get_user_calendars(service);
  if (!calendars.includes(BUFFER_TIME_CALENDAR)) {
    calendars[BUFFER_TIME_CALENDAR] = create_buffer_time_calendar(service);
  }

  // TODO: `now` has to be a day before for buffer time events because the
  // current event might have already started but the buffer time event for it
  // has already passed

  // js TODO: do we need to add Z?
  const now = Date.now();
  const time_min = now.toISOString();
  let time_max = new Date(now);
  time_max.setDate(time_max.getDate() + 13 - now.getDay());
  time_max = time_max.toISOString();

  let buffer_time_events = get_calendar_events(
    (service = service),
    (calendar_id = calendars[BUFFER_TIME_CALENDAR].id),
    (time_min = time_min),
    (time_max = time_max)
  );

  let event_to_buffer_time_event = {};
  for (const event in buffer_time_events) {
    for (const line in event.description.split("\n")) {
      if (line.startswith(EVENT_DESCRIPTION_ID_PREFIX)) {
        event_to_buffer_time_event[line.split(": ")[1]] = event;
      }
    }
  }

  // js TODO write in js
  const google_maps_client = googlemaps.Client(google_maps_key);

  // TODO don't iterate over calendars because we need the information of the
  // previous event of the current one (which can be in a different calendar).
  // Instead load all calendars at once and use pointers to get the events in
  // time order.
  for (const calendar_name in calendars) {
    if (!CALENDAR_WATCH_LIST.includes(calendar_name)) {
      continue;
    }

    let events = get_calendar_events(
      (service = service),
      (calendar_id = calendars[calendar_name].id),
      (time_min = time_min),
      (time_max = time_max)
    );

    if (!events.length) {
      // console.log("No upcoming events found.");
      continue;
    }

    events = iter(events); // js TODO js doesn't have iter
    let last_location;
    let last_location_time = 0;
    let full_day_event_location;
    let work_location; // TODO: get from working hours
    for (const event in events) {
      if (!!event.start?.dateTime) {
        full_day_event_location = event?.location;
        continue;
      }

      let seconds = new Date(event.end.dateTime);
      if (seconds >= now) {
        break;
      } else if (!!event?.location) {
        last_location = event.location;
        last_location_time = seconds;
      }
    }

    // js TODO js doesn't have chain
    events = chain([event], events);

    for (const event in events) {
      if (event_to_buffer_time_event.includes(event.id)) {
        // TODO: Check if location or time of main event was updated.
        // Update the Buffer time event accordingly.
        continue;
      }
    }
    let start_time = event.start?.dateTime;
    // TODO: if new date has started check for work_location
    if (!!start_time) {
      if (!!event?.location) {
        full_day_event_location = event.location;
      }
      continue;
    }

    if (!event?.organizer?.self) {
      let status;
      for (const a in event?.attendees) {
        if (!!a?.self) {
          status = a.responseStatus;
          break;
        }
      }
      // needsAction, tentative, accepted
      if (!["accepted", "tentative"].includes(status)) {
        continue;
      }
    }

    start_time = new Date(start_time);

    const event_location = event?.location;
    if (!!event_location) {
      continue;
    }

    // TODO: convert start time to integer
    const last_location =
      start_time - last_location_time < TIME_DELTA
        ? last_location
        : full_day_event_location || work_location || BASE_LOCATION;

    if (event_location === last_location) {
      continue;
    }

    const description_list = [
      "Commute time",
      "From: ${last_location}",
      "To: ${event_location}",
    ];

    let final_summary;
    let final_duration;
    for (const transport in TRANSPORTS) {
      const duration = get_duration(
        (google_maps_client = google_maps_client),
        (origin = last_location),
        (destination = event_location),
        (mode = transport),
        (arrival_time = start_time)
      );

      if (!duration) {
        continue;
      }

      const divmod = (x, y) => [Math.floor(x / y), x % y];
      const [minutes, seconds] = divmod(duration, 60);
      const [hours, minutes] = divmod(minutes, 60);
      if (hours > MAX_BUFFER_TIME_EVENT_DURATION) {
        // this event is going to keep recomputing distance matrix
        continue;
      }

      let title = "${EMOJI[transport]} ${transport} ";
      if (hours) {
        title += "${hours} hours";
      }
      if (minutes) {
        title += "${minutes} minutes";
      }

      description_list.push(title);

      if (transport === PREFERRED_TRANSPORT) {
        final_summary = description_list[-1];
        final_duration = duration;
        description_list[-1] = "[x] " + description_list[-1];
      } else {
        description_list[-1] = "[ ] " + description_list[-1];
      }
    }

    if (!final_summary) {
      continue;
    }

    const event_id = event.id;
    description_list.push(EVENT_DESCRIPTION_ID_PREFIX + event_id);
    description = description_list.join("\n");
    create_calendar_event(
      (service = service),
      (buffer_time_calendar_id = calendars[BUFFER_TIME_CALENDAR] / id),
      (summary = final_summary),
      (description = description),
      (start_time = start_time - final_duration),
      (end_time = start_time),
      (recurrence = ""),
      (timezone = event.start.timeZone)
    );

    last_location = event_location;
  }
}
