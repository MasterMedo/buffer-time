const BUFFER_TIME_CALENDAR = "Buffer time";
const EVENT_DESCRIPTION_ID_PREFIX = "Tied to event: ";
const PREFERRED_TRANSPORT = "driving";
const TRANSPORTS = ["driving", "walking", "bicycling", "transit"];
// possible values: [needsAction, tentative, accepted]
const EVENT_ACCEPTED_OR_MAYBE = ["accepted", "tentative"]
const EMOJI = { driving: "🚗", walking: "🚶", bicycling: "🚴", transit: "🚆" };
// Calendars that are buffer time events are created for.
const CALENDAR_WATCH_LIST = [
  "Events and activities",
  "Family",
  "mislav.vuletic@memgraph.io",
];
// Amount of time since last having a location to be considered the user
// went to the BASE_LOCATION instead of being at the last event location
const TIME_DELTA_SECONDS = 4 * 60 * 60;
// Home address, the address where the user spends their nights.
const BASE_LOCATION = "Radmanovačka ul. 6f, 10000, Zagreb";
const MAX_BUFFER_TIME_EVENT_SECONDS = 6 * 3600;

function main() {
  // get buffer time calendar
  var buffer_time_calendar = null;
  var buffer_time_calendars = getOwnedCalendarsByName(BUFFER_TIME_CALENDAR);
  if (buffer_time_calendars.length === 0) {
    buffer_time_calendar = CalendarApp.createCalendar(BUFFER_TIME_CALENDAR);
  } else {
    // assume user has only one buffer time calendar
    buffer_time_calendar = buffer_time_calendars[0];
  }

  var primary_calendar = CalendarApp.getDefaultCalendar();

  // assume all calendars have the same timezone as the default calendar
  const time_zone = primary_calendar.getTimeZone();
  const today = new Date();
  // google script doesn't provide a method to get first day of the week
  const week_day = Utilities.formatDate(today, time_zone, "u");
  const yesterday = new Date(today - 864e5).toISOString(); // day before
  const two_weeks = new Date(today + 846e5 * (14 - week_day)).toISOString();

  var buffer_time_events = buffer_time_calendar.getEvents(yesterday, two_weeks);

  // TODO don't iterate over calendars because we need the information of the
  // previous event of the current one (which can be in a different calendar).
  // Instead load all calendars at once and use pointers to get the events in
  // time order.
  for (const calendar_name of calendars) {
    if (!CALENDAR_WATCH_LIST.includes(calendar_name)) {
      continue;
    }

    let events = get_calendar_events({
      service: service,
      calendar_id: calendars[calendar_name].id,
      time_min: time_min,
      time_max: time_max,
    });

    if (!events.length) {
      // console.log("No upcoming events found.");
      continue;
    }

    events = iter(events); // js TODO js doesn't have iter
    let last_location;
    let last_location_time;
    let full_day_event_location; // TODO: add full_day_event_date and later check if current event has the same date as full day event and use this time only then
    let work_location; // TODO: get from working hours
    for (const event of events) {
      if (!event.start?.dateTime) {
        full_day_event_location = event?.location;
        continue;
      }

      let event_end_time = new Date(event.end.dateTime);
      if (event_end_time >= now) {
        break;
      } else if (!!event?.location) {
        last_location = event.location;
        last_location_time = event_end_time;
      }
    }

    events = chain([event], events); // js TODO js doesn't have chain

    for (const event of events) {
      if (event_to_buffer_time_event.includes(event.id)) {
        // TODO: Check if location or time of main event was updated.
        // Update the Buffer time event accordingly.
        continue;
      }

      let start_time = event.start?.dateTime;
      // TODO: if new date has started check for work_location
      if (!start_time) {
        if (!!event?.location) {
          full_day_event_location = event.location;
        }
        continue;
      }

      if (!event?.organizer?.self) {
        let status;
        for (const a of event?.attendees) {
          if (!!a?.self) {
            status = a.responseStatus;
            break;
          }
        }
        if (!EVENT_ACCEPTED_OR_MAYBE.includes(status)) {
          continue;
        }
      }

      const event_location = event?.location;
      if (!!event_location) {
        continue;
      }

      start_time = new Date(start_time);
      const last_location =
        // jel ovdje start_time sekunda ili date??
        start_time - last_location_time < TIME_DELTA_SECONDS * 1000
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
      for (const transport_mode of TRANSPORTS) {
        // https://developers.google.com/maps/documentation/javascript/directions?authuser=0#Legs
        var directions_seconds = Maps.newDirectionFinder()
          .setOrigin(last_location)
          .setDestination(event_location)
          .setArrive(start_time.getTime() / 1000)
          .setMode(transport_mode)
          .getDirections()
          .routes[0].legs[0].duration

        if (!duration_seconds) {
          continue;
        }

        if (duration_seconds > MAX_BUFFER_TIME_EVENT_SECONDS) {
          // this event is going to keep recomputing the travel duration
          continue;
        }

        const divmod = (x, y) => [Math.floor(x / y), x % y];
        const [minutes, seconds] = divmod(duration_seconds, 60);
        const [hours, minutes] = divmod(minutes, 60);

        let title = "${EMOJI[transport_mode]} ${transport_mode} ";
        if (hours) {
          title += "${hours} hours";
        }
        if (minutes) {
          title += "${minutes} minutes";
        }

        description_list.push(title);

        if (transport_mode === PREFERRED_TRANSPORT) {
          final_summary = description_list[-1];
          final_duration = duration_seconds;
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
      create_calendar_event({
        service: service,
        buffer_time_calendar_id: calendars[BUFFER_TIME_CALENDAR].id,
        summary: final_summary,
        description: description,
        start_time: new Date(start_time.getTime() - final_duration * 1000),
        end_time: start_time,
        recurrence: "",
        timezone: event.start.timeZone,
      });

      last_location = event_location;
    }
  }
}

function get_calendar_events(service, calendar_id, time_min, time_max) {
  const calendar_events_result = service
    .events()
    .list({
      calendarId: calendar_id,
      timeMin: time_min,
      timeMax: time_max,
      maxResults: 5,
      singleEvents: True,
      orderBy: "startTime",
    })
    .execute();
  const events = calendar_events_result?.items;
  return events || [];
}

function create_calendar_event({
  service,
  buffer_time_calendar_id,
  summary,
  description,
  start_time,
  end_time,
  timezone,
  recurrence,
} = {}) {
  const start = {
    dateTime: start_time.toISOString(),
    timeZone: timezone,
  };
  const end = {
    dateTime: end_time.toISOString(),
    timeZone: timezone,
  };
  const buffer_time_event = {
    summary: summary,
    // "location: "",
    description: description,
    start: start,
    end: end,
    // recurrence: recurrence,
  };
  const buffer_time_event = service
    .events()
    .insert({ calendarId: buffer_time_calendar_id, body: buffer_time_event })
    .execute();

  console.log("Event created{ %s" % buffer_time_event.get("htmlLink"));
}
